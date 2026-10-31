import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Card, Table, Button, Space, message, Typography, Modal, Input, InputNumber, Select,
  Row, Col, Tag, Statistic, DatePicker, Form,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined, DollarOutlined, PictureOutlined, SnippetsOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { safeSetItem } from '../utils/storageQuota';
import { compressImageFile } from '../utils/imageCompress';
import { pushBankTransaction, isAccountingMode, writeAutoEntries } from '../utils/accountingBridge';

const { Text } = Typography;
const PRIMARY = '#1e4a7e';

// 数据隔离（与全局 getDataOwner 口径一致：子账号使用主账号的 username）
const getDataOwner = (): string => {
  const isSub = localStorage.getItem('isSubAccount') === 'true';
  if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
  return localStorage.getItem('username') || '';
};

// 应付类别
const PAY_CATEGORIES = ['押金/保证金收取', '预收款项', '员工薪酬应付', '外部应付款', '代垫款项', '其他'];
const CAT_COLORS: Record<string, string> = {
  '押金/保证金收取': 'orange', '预收款项': 'purple', '员工薪酬应付': 'blue', '外部应付款': 'green', '代垫款项': 'cyan', '其他': 'default',
};

interface PayableRec {
  key: string;
  payDate: string;        // 应付日期
  counterparty: string;   // 收支对方（收款方/债权人）
  category: string;       // 应付类别
  amount: number;         // 应付金额
  dueDate: string;        // 预计支付日期
  paidAmount: number;     // 已付金额
  paidDate: string;       // 最近付款日期
  bankAccount: string;    // 关联收款银行账户名称
  payImage?: string;      // 付款凭证图片（base64）
  remark: string;
  createdAt: string;
}

const statusOf = (r: PayableRec): '已支付' | '部分支付' | '待支付' => {
  if ((Number(r.amount) || 0) > 0 && (Number(r.paidAmount) || 0) >= (Number(r.amount) || 0)) return '已支付';
  if ((Number(r.paidAmount) || 0) > 0) return '部分支付';
  return '待支付';
};

// 记账人显示名称（与全局口径一致：registeredUsers 三级回退）
const getDisplayName = (): string => {
  const username = localStorage.getItem('username') || '';
  try {
    const users = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const u = users.find((x: any) => x.username === username);
    if (u) return u.displayName || u.contactPerson || u.name || username;
  } catch { /* ignore */ }
  return username;
};

// 日常记账凭证号：PZ-YYYYMMDD-XXX 当日递增（与报销/提现链路同口径）
const genBookVoucherNo = (books: any[], date: string): string => {
  const prefix = `PZ-${date.replace(/-/g, '')}`;
  const seqs = books.map(b => String(b.voucherNo || '')).filter(v => v.startsWith(prefix)).map(v => parseInt(v.slice(-3), 10) || 0);
  return `${prefix}-${String((seqs.length ? Math.max(...seqs) : 0) + 1).padStart(3, '0')}`;
};

// 简易账薄-其他应付款：应付款项登记/付款核销台账
const OtherPayablesPanel: React.FC = () => {
  const owner = useMemo(() => getDataOwner(), []);
  const storageKey = `other_payables_${owner}`;

  const [records, setRecords] = useState<PayableRec[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PayableRec | null>(null);
  const [form] = Form.useForm();
  const [payTarget, setPayTarget] = useState<PayableRec | null>(null);
  const [payForm] = Form.useForm();
  const [payImage, setPayImage] = useState<string>('');
  const payFileRef = useRef<HTMLInputElement>(null);

  // 图片上传（点击选文件，统一经 imageCompress 压缩一次）
  const handleImageFile = async (file: File | Blob) => {
    if (!file.type.startsWith('image/')) { message.warning('只能上传图片文件'); return; }
    if (file.size > 5 * 1024 * 1024) { message.warning('图片不能超过 5MB'); return; }
    try {
      const dataUrl = await compressImageFile(file);
      setPayImage(dataUrl);
      message.success('图片已上传');
    } catch { message.warning('图片读取失败'); }
  };

  // 粘贴剪切板按键：读取剪切板中的图片
  const handlePasteClipboard = async () => {
    try {
      const items: any[] = await (navigator as any).clipboard.read();
      for (const it of items) {
        const type = (it.types || []).find((t: string) => t.startsWith('image/'));
        if (type) {
          const blob = await it.getType(type);
          const dataUrl = await compressImageFile(blob);
          setPayImage(dataUrl);
          message.success('已粘贴剪切板图片');
          return;
        }
      }
      message.warning('剪切板中未找到图片');
    } catch {
      message.warning('读取剪切板失败，可在上传框内 Ctrl+V 粘贴或点击选文件');
    }
  };
  const [searchText, setSearchText] = useState('');
  const [searchCat, setSearchCat] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [previewImage, setPreviewImage] = useState('');
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);

  const load = useCallback(() => {
    try { setRecords(JSON.parse(localStorage.getItem(storageKey) || '[]')); } catch { setRecords([]); }
    try { setBankAccounts(JSON.parse(localStorage.getItem(`pageData_finance_bank-account_${owner}`) || '[]')); } catch { setBankAccounts([]); }
  }, [storageKey, owner]);
  useEffect(() => { load(); }, [load]);

  const bankOptions = useMemo(() => bankAccounts.map((a: any) => ({
    value: a.name,
    label: `${a.name}${a.bankName ? `（${a.bankName}）` : ''}`,
  })), [bankAccounts]);

  // 应付款收款/付款联动：银行明细 + 双路账薄（会计模式写分录，简易模式写日常记账）
  const writePayLink = (opts: {
    bookKey: string; sourceKey: string; type: 'in' | 'out'; amount: number;
    accountName: string; counterparty: string; remarkPlain: string;
  }) => {
    try {
      const bankAcc = bankAccounts.find((b: any) => b.name === opts.accountName);
      const bankName = bankAcc?.bankName || '';
      const today = new Date().toISOString().slice(0, 10);
      const person = getDisplayName();
      if (isAccountingMode(owner)) {
        const vNo = writeAutoEntries(owner, {
          sourceKey: opts.sourceKey,
          debitSubject: opts.type === 'in' ? '银行存款' : '其他应付款',
          creditSubject: opts.type === 'in' ? '其他应付款' : '银行存款',
          amount: opts.amount,
          summary: opts.remarkPlain,
          date: today,
          bookkeeper: person, cashier: person,
        });
        pushBankTransaction(owner, opts.accountName, opts.type, opts.amount, `${opts.remarkPlain}（凭证${vNo || '—'}）`, person);
        return;
      }
      const bkKey = `daily_bookkeeping_${owner}`;
      const books: any[] = JSON.parse(localStorage.getItem(bkKey) || '[]');
      const voucherNo = genBookVoucherNo(books, today);
      const txRemark = `${opts.remarkPlain}（凭证${voucherNo}）`;
      pushBankTransaction(owner, opts.accountName, opts.type, opts.amount, txRemark, person);
      const rec: any = {
        key: opts.bookKey,
        voucherNo,
        bookDate: today,
        bookType: opts.type === 'in' ? '收入' : '支出',
        category: opts.type === 'in' ? '其他业务收入-其他收入' : '财务费用-其他支出',
        amount: opts.amount,
        counterparty: opts.counterparty,
        remark: txRemark,
        person,
        recvAccount: opts.type === 'in' ? opts.accountName : '',
        recvBank: opts.type === 'in' ? bankName : '',
        payAccount: opts.type === 'out' ? opts.accountName : '',
        payBank: opts.type === 'out' ? bankName : '',
        image: '',
        isPersonalAdvance: false,
        isReturn: false,
        advanceRecvAccount: '',
        linkedReimbursementKey: '',
        linkedWithdrawalKey: '',
        autoSourceKey: opts.sourceKey,
        createdAt: new Date().toISOString(),
      };
      safeSetItem(bkKey, JSON.stringify([rec, ...books]));
    } catch (err) { console.error('其他应付款联动写入失败', err); }
  };

  const save = (list: PayableRec[]) => {
    setRecords(list);
    safeSetItem(storageKey, JSON.stringify(list));
  };

  // 新增/编辑保存
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const now = new Date().toLocaleString('zh-CN');
      if (editing) {
        save(records.map(r => r.key === editing.key ? {
          ...r,
          payDate: values.payDate ? dayjs(values.payDate).format('YYYY-MM-DD') : r.payDate,
          counterparty: values.counterparty, category: values.category,
          amount: Number(values.amount) || 0,
          dueDate: values.dueDate ? dayjs(values.dueDate).format('YYYY-MM-DD') : '',
          bankAccount: values.bankAccount || '',
          remark: values.remark || '',
        } : r));
        message.success('已保存修改');
      } else {
        const rec: PayableRec = {
          key: `pay-${Date.now()}`,
          payDate: values.payDate ? dayjs(values.payDate).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD'),
          counterparty: values.counterparty, category: values.category,
          amount: Number(values.amount) || 0,
          dueDate: values.dueDate ? dayjs(values.dueDate).format('YYYY-MM-DD') : '',
          paidAmount: 0, paidDate: '',
          bankAccount: values.bankAccount || '',
          remark: values.remark || '',
          createdAt: now,
        };
        const commit = () => {
          save([rec, ...records]);
          if (rec.bankAccount) {
            // 联动：所选银行账户写收款明细 + 自动记账
            writePayLink({
              bookKey: `bk-opay-${rec.key}`,
              sourceKey: `opay-${rec.key}`,
              type: 'in',
              amount: rec.amount,
              accountName: rec.bankAccount,
              counterparty: rec.counterparty,
              remarkPlain: `其他应付款-${rec.category}-${rec.counterparty}`,
            });
          }
          message.success('其他应付款已登记');
          setModalVisible(false);
        };
        // 收款银行账户非必填：未选择时弹窗提示后果后再保存
        if (!values.bankAccount) {
          Modal.confirm({
            title: '未选择收款银行账户',
            content: '未选择收款银行账户保存时，将不会生成银行账户明细和日常记账记录，是否继续保存？',
            okText: '继续保存', cancelText: '去选择', onOk: commit,
          });
        } else {
          commit();
        }
        return;
      }
      setModalVisible(false);
    } catch { /* validation failed */ }
  };

  // 付款核销
  const handlePay = async () => {
    if (!payTarget) return;
    try {
      const values = await payForm.validateFields();
      const amt = Number(values.amount) || 0;
      if (amt <= 0) { message.warning('请输入大于0的付款金额'); return; }
      const outstanding = (Number(payTarget.amount) || 0) - (Number(payTarget.paidAmount) || 0);
      if (amt > outstanding + 1e-9) { message.warning(`付款金额不能超过未付余额 ¥${outstanding.toFixed(2)}`); return; }
      const payDate = values.payDate ? dayjs(values.payDate).format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD');
      const evtTs = Date.now();
      save(records.map(r => r.key === payTarget.key ? {
        ...r,
        paidAmount: Math.round(((Number(r.paidAmount) || 0) + amt) * 100) / 100,
        paidDate: payDate,
        payImage: payImage || r.payImage,
        remark: values.remark ? `${r.remark ? r.remark + '；' : ''}${payDate} 付款 ¥${amt.toFixed(2)}${values.remark ? '（' + values.remark + '）' : ''}` : r.remark,
      } : r));
      // 选择了付款银行账户时联动：银行付出明细 + 自动记账
      if (values.bankAccount) {
        writePayLink({
          bookKey: `bk-opayp-${payTarget.key}-${evtTs}`,
          sourceKey: `opay-pay-${payTarget.key}-${evtTs}`,
          type: 'out',
          amount: amt,
          accountName: values.bankAccount,
          counterparty: payTarget.counterparty,
          remarkPlain: `其他应付款付款-${payTarget.counterparty}`,
        });
      }
      message.success(`已登记付款 ¥${amt.toFixed(2)}`);
      setPayTarget(null);
    } catch { /* validation failed */ }
  };

  const display = useMemo(() => {
    let list = records;
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(r => (r.counterparty || '').toLowerCase().includes(q) || (r.remark || '').toLowerCase().includes(q));
    }
    if (searchCat) list = list.filter(r => r.category === searchCat);
    if (searchStatus) list = list.filter(r => statusOf(r) === searchStatus);
    return list.slice().sort((a, b) => (b.payDate || '').localeCompare(a.payDate || ''));
  }, [records, searchText, searchCat, searchStatus]);

  const totals = useMemo(() => {
    const amt = records.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const paid = records.reduce((s, r) => s + (Number(r.paidAmount) || 0), 0);
    return { amt, paid, outstanding: amt - paid };
  }, [records]);

  const fmt = (v: number) => (v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const columns: ColumnsType<PayableRec> = [
    { title: '序号', key: 'seq', width: 50, align: 'center', render: (_v, _r, i) => i + 1 },
    { title: '应付日期', dataIndex: 'payDate', key: 'payDate', width: 110, align: 'center' },
    { title: '收支对方', dataIndex: 'counterparty', key: 'counterparty', width: 160, render: v => <Text strong>{v || '—'}</Text> },
    { title: '类别', dataIndex: 'category', key: 'category', width: 120, align: 'center', render: v => <Tag color={CAT_COLORS[v] || 'default'}>{v || '其他'}</Tag> },
    { title: '应付金额', dataIndex: 'amount', key: 'amount', width: 120, align: 'right', render: v => <Text strong style={{ color: PRIMARY }}>¥{fmt(v)}</Text> },
    { title: '预计支付日期', dataIndex: 'dueDate', key: 'dueDate', width: 120, align: 'center', render: (v: string, r: any) => {
      if (!v) return '—';
      const overdue = statusOf(r) !== '已支付' && dayjs(v).isBefore(dayjs(), 'day');
      return <Text style={{ color: overdue ? '#ff4d4f' : undefined }}>{v}{overdue ? '（逾期）' : ''}</Text>;
    } },
    { title: '已付金额', dataIndex: 'paidAmount', key: 'paidAmount', width: 120, align: 'right', render: v => v ? <Text style={{ color: '#52c41a' }}>¥{fmt(v)}</Text> : '—' },
    { title: '未付余额', key: 'outstanding', width: 120, align: 'right', render: (_v, r) => {
      const o = (Number(r.amount) || 0) - (Number(r.paidAmount) || 0);
      return <Text strong style={{ color: o > 0 ? '#ff4d4f' : '#8c8c8c' }}>¥{fmt(o)}</Text>;
    } },
    { title: '状态', key: 'status', width: 90, align: 'center', render: (_v, r) => {
      const st = statusOf(r);
      return <Tag color={st === '已支付' ? 'green' : st === '部分支付' ? 'orange' : 'blue'}>{st}</Tag>;
    } },
    { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true, render: v => v || '—' },
    { title: '图片', dataIndex: 'payImage', key: 'payImage', width: 70, align: 'center', render: (v: string) => (
      v ? (
        <img src={v} alt="付款凭证" onClick={() => setPreviewImage(v)}
          style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid #eee', verticalAlign: 'middle' }} />
      ) : '—'
    ) },
    { title: '操作', key: 'action', width: 140, align: 'center', render: (_v, r) => {
      const paid = statusOf(r) === '已支付';
      return (
        <Space size={2} wrap>
          {!paid && (
            <Button type="link" size="small" icon={<DollarOutlined />} style={{ color: '#fa8c16' }}
              onClick={() => { setPayTarget(r); payForm.resetFields(); payForm.setFieldsValue({ amount: (Number(r.amount) || 0) - (Number(r.paidAmount) || 0), payDate: dayjs(), bankAccount: r.bankAccount || undefined }); setPayImage(r.payImage || ''); setModalVisible(false); }}>付款</Button>
          )}
          {/* 已支付状态：编辑按键移除 */}
          {!paid && (
            <Button type="link" size="small" icon={<EditOutlined />}
              onClick={() => { setEditing(r); form.setFieldsValue({ payDate: r.payDate ? dayjs(r.payDate) : null, counterparty: r.counterparty, category: r.category, amount: r.amount, dueDate: r.dueDate ? dayjs(r.dueDate) : null, bankAccount: r.bankAccount || undefined, remark: r.remark }); setModalVisible(true); }}>编辑</Button>
          )}
          {paid && <Text type="secondary">—</Text>}
        </Space>
      );
    } },
  ];

  return (
    <div style={{ padding: 16 }}>
      {/* 汇总卡片 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small" style={{ borderTop: '3px solid #1890ff' }}>
            <Statistic title="应付总额" value={totals.amt} precision={2} prefix="¥" valueStyle={{ color: '#1890ff', fontSize: 18 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderTop: '3px solid #52c41a' }}>
            <Statistic title="已付总额" value={totals.paid} precision={2} prefix="¥" valueStyle={{ color: '#52c41a', fontSize: 18 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderTop: '3px solid #ff4d4f' }}>
            <Statistic title="未付余额" value={totals.outstanding} precision={2} prefix="¥" valueStyle={{ color: '#ff4d4f', fontSize: 18 }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderTop: '3px solid #722ed1' }}>
            <Statistic title="记录笔数" value={records.length} suffix="笔" valueStyle={{ color: '#722ed1', fontSize: 18 }} />
          </Card>
        </Col>
      </Row>

      {/* 搜索栏 */}
      <Row gutter={[8, 8]} style={{ marginBottom: 12 }} align="middle">
        <Col xs={12} sm={5}>
          <Input size="small" allowClear placeholder="搜索对方/备注" prefix={<SearchOutlined />} value={searchText} onChange={e => setSearchText(e.target.value)} />
        </Col>
        <Col xs={12} sm={4}>
          <Select size="small" allowClear placeholder="类别" style={{ width: '100%' }} value={searchCat || undefined}
            onChange={v => setSearchCat(v || '')} options={PAY_CATEGORIES.map(c => ({ value: c, label: c }))} />
        </Col>
        <Col xs={12} sm={4}>
          <Select size="small" allowClear placeholder="状态" style={{ width: '100%' }} value={searchStatus || undefined}
            onChange={v => setSearchStatus(v || '')}
            options={[{ value: '待支付', label: '待支付' }, { value: '部分支付', label: '部分支付' }, { value: '已支付', label: '已支付' }]} />
        </Col>
        <Col flex="auto" style={{ textAlign: 'right' }}>
          <Button type="primary" size="small" icon={<PlusOutlined />} style={{ color: '#fff' }}
            onClick={() => { setEditing(null); form.resetFields(); form.setFieldsValue({ payDate: dayjs(), category: '其他' }); setModalVisible(true); }}>新增应付款</Button>
        </Col>
      </Row>

      <Table<PayableRec>
        bordered
        size="small"
        rowKey="key"
        dataSource={display}
        columns={columns}
        pagination={{ pageSize: 15, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
        locale={{ emptyText: '暂无其他应付款记录，点击「新增应付款」开始登记' }}
        summary={() => {
          if (display.length === 0) return null;
          const amt = display.reduce((s, r) => s + (Number(r.amount) || 0), 0);
          const paid = display.reduce((s, r) => s + (Number(r.paidAmount) || 0), 0);
          return (
            <Table.Summary.Row style={{ background: '#fafafa' }}>
              <Table.Summary.Cell index={0} colSpan={4} align="right"><Text strong>合计</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right"><Text strong style={{ color: PRIMARY }}>¥{fmt(amt)}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={2} />
              <Table.Summary.Cell index={3} align="right"><Text strong style={{ color: '#52c41a' }}>¥{fmt(paid)}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right"><Text strong style={{ color: '#ff4d4f' }}>¥{fmt(amt - paid)}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={5} colSpan={4} />
            </Table.Summary.Row>
          );
        }}
      />

      {/* 新增/编辑弹窗 */}
      <Modal
        title={<span style={{ color: PRIMARY }}><DollarOutlined style={{ marginRight: 8 }} />{editing ? '编辑其他应付款' : '新增其他应付款'}</span>}
        open={modalVisible}
        onOk={handleSave}
        onCancel={() => setModalVisible(false)}
        okText="保存" cancelText="取消" width={520} destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="payDate" label="应付日期" rules={[{ required: true, message: '请选择应付日期' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="category" label="类别" rules={[{ required: true, message: '请选择类别' }]}>
                <Select options={PAY_CATEGORIES.map(c => ({ value: c, label: c }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="counterparty" label="收支对方（收款方）" rules={[{ required: true, message: '请输入收款方名称' }]}>
            <Input placeholder="如：某供应商/某员工/某单位" />
          </Form.Item>
          <Form.Item name="bankAccount" label="收款银行账户">
            <Select allowClear showSearch optionFilterProp="label" placeholder="选择资金到账的银行账户（可选）" options={bankOptions} />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="amount" label="应付金额" rules={[{ required: true, message: '请输入应付金额' }]}>
                <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="¥" placeholder="0.00" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="dueDate" label="预计支付日期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="备注说明（选填）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 付款核销弹窗 */}
      <Modal
        title={<span style={{ color: '#fa8c16' }}><DollarOutlined style={{ marginRight: 8 }} />付款登记 — {payTarget?.counterparty || ''}</span>}
        open={!!payTarget}
        onOk={handlePay}
        onCancel={() => setPayTarget(null)}
        okText="确认付款" cancelText="取消" width={440} destroyOnClose
      >
        {payTarget && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f6f8fa', border: '1px solid #e3e8ee', borderRadius: 6, fontSize: 12, color: '#5a6d85', lineHeight: 1.8 }}>
            应付 ¥{fmt(payTarget.amount)}　已付 ¥{fmt(payTarget.paidAmount)}　未付 <Text strong style={{ color: '#ff4d4f' }}>¥{fmt((Number(payTarget.amount) || 0) - (Number(payTarget.paidAmount) || 0))}</Text>
          </div>
        )}
        <Form form={payForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="amount" label="本次付款金额" rules={[{ required: true, message: '请输入付款金额' }]}>
                <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="¥" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="payDate" label="付款日期" rules={[{ required: true, message: '请选择付款日期' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="remark" label="付款备注">
            <Input placeholder="选填，将追加到记录备注" />
          </Form.Item>
          <Form.Item name="bankAccount" label="付款银行账户">
            <Select allowClear showSearch optionFilterProp="label" placeholder="选择资金付出的银行账户（可选）" options={bankOptions} />
          </Form.Item>
          <Form.Item label="付款凭证图片">
            <Space align="start">
              {payImage ? (
                <div style={{ position: 'relative', width: 96, height: 96 }}>
                  <img src={payImage} alt="付款凭证" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 6, border: '1px solid #d9d9d9' }} />
                  <Button size="small" danger icon={<DeleteOutlined />} style={{ position: 'absolute', top: -8, right: -8 }} onClick={() => setPayImage('')} />
                </div>
              ) : (
                <>
                  <div tabIndex={0}
                    onPaste={e => {
                      const items = e.clipboardData?.items;
                      if (!items) return;
                      for (let i = 0; i < items.length; i++) {
                        if (items[i].type.startsWith('image/')) {
                          const f = items[i].getAsFile();
                          if (f) handleImageFile(f);
                          return;
                        }
                      }
                    }}
                    onClick={() => payFileRef.current?.click()}
                    style={{ width: 96, height: 96, border: '1px dashed #d9d9d9', borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#999', fontSize: 12, lineHeight: '18px', textAlign: 'center', outline: 'none' }}>
                    <PictureOutlined style={{ fontSize: 20, marginBottom: 4 }} />
                    点击上传
                    （可Ctrl+V）
                  </div>
                  <Button icon={<SnippetsOutlined />} onClick={handlePasteClipboard}>粘贴剪切板</Button>
                </>
              )}
            </Space>
            <input ref={payFileRef} type="file" accept="image/*" hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 付款凭证图片预览 */}
      <Modal open={!!previewImage} footer={null} centered width={720} onCancel={() => setPreviewImage('')}>
        {previewImage && <img src={previewImage} alt="付款凭证预览" style={{ width: '100%', borderRadius: 8 }} />}
      </Modal>
    </div>
  );
};

export default OtherPayablesPanel;
