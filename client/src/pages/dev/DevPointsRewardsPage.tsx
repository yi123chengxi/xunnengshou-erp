import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, Table, Button, Space, Modal, Form, Input, InputNumber, message, Tag, Popconfirm, Tabs, Image, Upload, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, GiftOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  loadDevRewards, saveDevRewards, loadDevRedeems, saveDevRedeems, calcDevBalance, getDevIdentity, loadDevSubAccounts,
} from '../../utils/devStore';
import type { DevReward, DevRedeem } from '../../utils/devStore';

// ===================== 奖品图片 IndexedDB 存储 =====================
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
const getImg = async (key: string): Promise<string | null> => {
  const db = await openImgDb();
  return new Promise((resolve) => {
    const tx = db.transaction('imgs', 'readonly');
    const req = tx.objectStore('imgs').get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
};

// 开发者后台 - 系统设置 - 积分兑换奖品（参考 my-crm settings/points-rewards）
const DevPointsRewardsPage: React.FC = () => {
  const identity = getDevIdentity();
  const isMain = identity.user === 'dev';
  const [rewards, setRewards] = useState<DevReward[]>([]);
  const [redeems, setRedeems] = useState<DevRedeem[]>([]);
  const [imgUrls, setImgUrls] = useState<Record<string, string>>({});
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<DevReward | null>(null);
  const [form] = Form.useForm();
  const [formImage, setFormImage] = useState<string>(''); // dataURL 预览
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    const rs = loadDevRewards();
    setRewards(rs);
    setRedeems(loadDevRedeems());
    rs.forEach(r => {
      if (r.imageKey && !imgUrls[r.imageKey]) {
        getImg(r.imageKey).then(url => { if (url) setImgUrls(prev => ({ ...prev, [r.imageKey as string]: url })); });
      }
    });
  }, []); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const balance = calcDevBalance(identity.user);

  // 图片上传（点击/粘贴/拖拽 → dataURL → IndexedDB）
  const handleFiles = useCallback(async (files: File[]) => {
    const img = files.find(f => f.type.startsWith('image/'));
    if (!img) return;
    const reader = new FileReader();
    reader.onload = async () => { setFormImage(String(reader.result)); };
    reader.readAsDataURL(img);
  }, []);

  const handleSave = () => {
    form.validateFields().then(async values => {
      const name = String(values.name || '').trim();
      if (!name) return;
      let imageKey = editing?.imageKey || '';
      if (formImage && formImage.startsWith('data:')) {
        imageKey = `reward_${editing?.id || Date.now()}`;
        try { await putImg(imageKey, formImage); } catch { message.error('图片保存失败'); return; }
      }
      if (editing) {
        const next = loadDevRewards().map(r => r.id === editing.id ? {
          ...r, name, description: values.description || '', pointsCost: Number(values.pointsCost) || 0,
          stock: values.stock === undefined || values.stock === null ? -1 : Number(values.stock),
          sortOrder: Number(values.sortOrder) || 0, imageKey,
        } : r);
        saveDevRewards(next);
        message.success(`奖品「${name}」已更新`);
      } else {
        const entry: DevReward = {
          id: `rw_${Date.now()}`, name, description: values.description || '',
          pointsCost: Number(values.pointsCost) || 0,
          stock: values.stock === undefined || values.stock === null ? -1 : Number(values.stock),
          sortOrder: Number(values.sortOrder) || 0, imageKey, isActive: true,
          createdAt: dayjs().format('YYYY-MM-DD HH:mm'),
        };
        saveDevRewards([...loadDevRewards(), entry]);
        message.success(`奖品「${name}」已添加`);
      }
      setModalVisible(false);
      setFormImage('');
      load();
    }).catch(() => message.warning('请完善奖品名称与所需积分'));
  };

  const handleToggle = (r: DevReward) => {
    saveDevRewards(loadDevRewards().map(x => x.id === r.id ? { ...x, isActive: !x.isActive } : x));
    message.success(r.isActive ? `奖品「${r.name}」已下架` : `奖品「${r.name}」已启用`);
    load();
  };

  const handleDelete = (r: DevReward) => {
    saveDevRewards(loadDevRewards().filter(x => x.id !== r.id));
    message.success('奖品已删除（兑换记录保留）');
    load();
  };

  // 兑换申请（子账号）与审批（主开发者）
  const handleRedeem = (r: DevReward) => {
    if (balance.available < r.pointsCost) { message.error(`积分不足：可用 ${balance.available}，需要 ${r.pointsCost}`); return; }
    if (r.stock === 0) { message.error('该奖品库存不足'); return; }
    const entry: DevRedeem = {
      id: `rd_${Date.now()}`, rewardId: r.id, rewardName: r.name,
      username: identity.user, displayName: identity.name,
      points: r.pointsCost, status: '待审批', createdAt: dayjs().format('YYYY-MM-DD HH:mm'),
    };
    saveDevRedeems([entry, ...loadDevRedeems()]);
    message.success(`兑换申请已提交，等待主开发者审批（冻结 ${r.pointsCost} 积分）`);
    load();
  };

  const handleApprove = (rec: DevRedeem, ok: boolean) => {
    const next = loadDevRedeems().map(x => x.id === rec.id ? { ...x, status: ok ? '已兑换' as const : '已拒绝' as const, handledBy: identity.name } : x);
    saveDevRedeems(next);
    if (ok) {
      const rs = loadDevRewards().map(r => r.id === rec.rewardId && r.stock > 0 ? { ...r, stock: r.stock - 1 } : r);
      saveDevRewards(rs);
    }
    message.success(ok ? `已批准 ${rec.displayName} 兑换「${rec.rewardName}」` : `已拒绝 ${rec.displayName} 的兑换申请，积分已解冻`);
    load();
  };

  const rewardColumns: any[] = [
    {
      title: '奖品图片', key: 'image', width: 100, align: 'center',
      render: (_: any, r: DevReward) => r.imageKey && imgUrls[r.imageKey]
        ? <Image src={imgUrls[r.imageKey]} width={56} height={42} style={{ objectFit: 'cover', borderRadius: 6 }} />
        : <div style={{ width: 56, height: 42, background: '#fafafa', borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 11, border: '1px solid #f0f0f0' }}>无图</div>,
    },
    { title: '奖品名称', dataIndex: 'name', width: 160, align: 'center', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    { title: '描述', dataIndex: 'description', width: 180, align: 'center', render: (v: string) => v || '—' },
    { title: '所需积分', dataIndex: 'pointsCost', width: 100, align: 'center', render: (v: number) => <Tag color="gold">{v} 积分</Tag> },
    { title: '库存', dataIndex: 'stock', width: 90, align: 'center', render: (v: number) => v === -1 ? '不限' : v },
    { title: '排序', dataIndex: 'sortOrder', width: 70, align: 'center' },
    {
      title: '状态', dataIndex: 'isActive', width: 90, align: 'center',
      render: (v: boolean) => v ? <Tag color="green">启用中</Tag> : <Tag color="default">已下架</Tag>,
    },
    {
      title: '操作', key: 'action', width: 220, align: 'center',
      render: (_: any, r: DevReward) => (
        <Space size={4}>
          {!isMain && r.isActive && (
            <Tooltip title={`可用积分 ${balance.available}`}>
              <Button size="small" type="link" icon={<GiftOutlined />} disabled={balance.available < r.pointsCost || r.stock === 0} onClick={() => handleRedeem(r)}>兑换</Button>
            </Tooltip>
          )}
          <Button size="small" type="link" onClick={() => handleToggle(r)}>{r.isActive ? '下架' : '启用'}</Button>
          <Tooltip title="编辑"><Button size="small" type="link" icon={<EditOutlined />} onClick={() => {
            setEditing(r);
            form.setFieldsValue({ name: r.name, description: r.description || '', pointsCost: r.pointsCost, stock: r.stock, sortOrder: r.sortOrder });
            setFormImage(r.imageKey && imgUrls[r.imageKey] ? imgUrls[r.imageKey] : '');
            setModalVisible(true);
          }} /></Tooltip>
          <Popconfirm title="确定删除该奖品？（兑换记录会保留）" onConfirm={() => handleDelete(r)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
            <Tooltip title="删除"><Button size="small" type="link" danger icon={<DeleteOutlined />} /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const redeemColumns: any[] = [
    { title: '申请人', dataIndex: 'displayName', width: 120, align: 'center' },
    { title: '账号', dataIndex: 'username', width: 120, align: 'center' },
    { title: '奖品', dataIndex: 'rewardName', width: 160, align: 'center' },
    { title: '消耗积分', dataIndex: 'points', width: 100, align: 'center', render: (v: number) => <Tag color="gold">{v}</Tag> },
    { title: '申请时间', dataIndex: 'createdAt', width: 150, align: 'center' },
    {
      title: '状态', dataIndex: 'status', width: 100, align: 'center',
      render: (v: string) => v === '待审批' ? <Tag color="orange">待审批</Tag> : v === '已兑换' ? <Tag color="green">已兑换</Tag> : <Tag color="red">已拒绝</Tag>,
    },
    { title: '处理人', dataIndex: 'handledBy', width: 100, align: 'center', render: (v: string) => v || '—' },
    ...(isMain ? [{
      title: '操作', key: 'action', width: 160, align: 'center',
      render: (_: any, r: DevRedeem) => r.status === '待审批' ? (
        <Space size={4}>
          <Button size="small" type="link" style={{ color: '#52c41a' }} onClick={() => handleApprove(r, true)}>批准</Button>
          <Button size="small" type="link" danger onClick={() => handleApprove(r, false)}>拒绝</Button>
        </Space>
      ) : '—',
    }] : []),
  ];

  return (
    <div style={{ padding: 16 }}>
      <Card
        title={<span><GiftOutlined style={{ color: '#faad14', marginRight: 8 }} />积分兑换奖品</span>}
        extra={
          <Space>
            {!isMain && (
              <Tooltip title={balance.detail}>
                <Tag color="purple" style={{ fontSize: 13, padding: '4px 10px' }}>
                  我的积分：可用 {balance.available}（获得 {balance.earned} - 已兑 {balance.spent} - 冻结 {balance.pending}）
                </Tag>
              </Tooltip>
            )}
            <Button type="primary" icon={<PlusOutlined />} onClick={() => {
              setEditing(null);
              form.resetFields();
              form.setFieldsValue({ pointsCost: 10, stock: -1, sortOrder: 0 });
              setFormImage('');
              setModalVisible(true);
            }}>添加奖品</Button>
          </Space>
        }
      >
        <p style={{ color: '#999', fontSize: 12, marginTop: 0 }}>
          设置可兑换的奖品及所需积分，积分兑换不影响绩效考核数据。积分规则：领取客户 +5、本月新领额外 +5、客户审核通过 +10；子账号申请兑换后由主开发者审批。
        </p>
        <Tabs
          defaultActiveKey="rewards"
          items={[
            { key: 'rewards', label: `奖品管理（${rewards.length}）`, children: (
              <Table rowKey="id" bordered size="middle" columns={rewardColumns} dataSource={rewards} pagination={false}
                locale={{ emptyText: '暂无奖品，点击「添加奖品」创建' }} />
            ) },
            { key: 'redeems', label: `兑换记录（${redeems.length}）`, children: (
              <Table rowKey="id" bordered size="middle" columns={redeemColumns}
                dataSource={isMain ? redeems : redeems.filter(r => r.username === identity.user)}
                pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条` }}
                locale={{ emptyText: '暂无兑换记录' }} />
            ) },
          ]}
        />
      </Card>

      <Modal
        title={editing ? `编辑奖品 - ${editing.name}` : '添加新奖品'}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => { setModalVisible(false); setFormImage(''); }}
        okText="保存"
        cancelText="取消"
        width={560}
        destroyOnClose
      >
        <Form autoComplete="off" form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="name" label="奖品名称" rules={[{ required: true, message: '请输入奖品名称' }]} style={{ width: 260 }}>
              <Input placeholder="如：星巴克咖啡券" maxLength={30} />
            </Form.Item>
            <Form.Item name="pointsCost" label="所需积分" rules={[{ required: true, message: '请输入所需积分' }]} style={{ width: 120 }}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space style={{ display: 'flex' }} size={12}>
            <Form.Item name="stock" label="库存（-1 不限）" style={{ width: 140 }}>
              <InputNumber min={-1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序（越小越靠前）" style={{ width: 140 }}>
              <InputNumber style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="奖品描述">
            <Input placeholder="选填" maxLength={60} />
          </Form.Item>
          <Form.Item label="奖品图片（点击上传 / 粘贴 / 拖拽）">
            <div
              onPaste={e => { const files = Array.from(e.clipboardData?.items || []).map(i => i.getAsFile()).filter((f): f is File => !!f && f.type.startsWith('image/')); if (files.length) { e.preventDefault(); handleFiles(files); } }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFiles(Array.from(e.dataTransfer.files)); }}
              tabIndex={0}
              style={{ outline: 'none' }}
            >
              {formImage ? (
                <Space>
                  <Image src={formImage} width={96} height={72} style={{ objectFit: 'cover', borderRadius: 8 }} />
                  <Button size="small" danger onClick={() => setFormImage('')}>移除图片</Button>
                </Space>
              ) : (
                <Upload accept="image/*" showUploadList={false} beforeUpload={f => { handleFiles([f]); return false; }}>
                  <Button icon={<UploadOutlined />}>上传图片</Button>
                </Upload>
              )}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} />
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default DevPointsRewardsPage;
