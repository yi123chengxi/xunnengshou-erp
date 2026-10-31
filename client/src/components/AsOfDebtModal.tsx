/**
 * 截止欠款查询弹窗（供应商「截止应收欠款」/ 采购商「截止应付欠款」共用）
 *
 * 两种语义：
 *  - 旧欠残留（默认）：欠款 = Σ账单(日期≤货款截止日D) − Σ收付款(日期≤收付截止日D2)，
 *    即"D 之前产生的货款，到 D2 为止还剩多少未结"，D 之后的收付款自动先冲旧债（FIFO 直觉）；
 *  - 时点余额：欠款 = Σ账单(≤D) − Σ收付款(≤D)，回答"D 当天账面欠多少"。
 * 无日期单据默认计入并单独计数提示；金额为纯派生计算，不写任何存储。
 */
import React, { useMemo, useState } from 'react';
import { Modal, Radio, DatePicker, Button, Table, Typography, Space, Tag, message } from 'antd';
import { ExportOutlined, FileSearchOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';

const { Text } = Typography;

const round2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const dstr = (v: any) => String(v == null ? '' : v).slice(0, 10);
const trim = (v: any) => String(v == null ? '' : v).trim();

export interface AsOfSource {
  list: any[];
  name: (x: any) => string;
  date: (x: any) => string;
  amount: (x: any) => number;
  no: (x: any) => string;
}

export interface AsOfDebtModalProps {
  open: boolean;
  onClose: () => void;
  title: string;        // 弹窗标题
  nameLabel: string;    // 客户 / 供应商
  debtLabel: string;    // 截止应收欠款 / 截止应付欠款
  billLabel: string;    // 账单 / 采购账单
  payLabel: string;     // 收款 / 付款
  names: string[];
  bills: AsOfSource;
  pays: AsOfSource;
}

interface Row {
  key: string;
  name: string;
  billCount: number;
  billAmount: number;
  undatedBills: number;
  payCount: number;
  payAmount: number;
  crossAmount: number;   // 跨期冲抵（D 之后、D2 之前的收付款合计，仅旧欠模式）
  undatedPays: number;
  debt: number;
}

const AsOfDebtModal: React.FC<AsOfDebtModalProps> = (props) => {
  const { open, onClose, title, nameLabel, debtLabel, billLabel, payLabel, names, bills, pays } = props;
  // 草稿态：绑定控件，用户操作时立即更新
  const [draftMode, setDraftMode] = useState<'legacy' | 'point'>('legacy');
  const [draftCutoff, setDraftCutoff] = useState<Dayjs>(dayjs());
  const [draftPayCutoff, setDraftPayCutoff] = useState<Dayjs>(dayjs());
  // 应用态：查询按钮点击后才同步，rows/detail 依赖此态
  const [mode, setMode] = useState<'legacy' | 'point'>('legacy');
  const [cutoff, setCutoff] = useState<Dayjs>(dayjs());
  const [payCutoff, setPayCutoff] = useState<Dayjs>(dayjs());
  const [detailName, setDetailName] = useState<string | null>(null);

  const D = cutoff.format('YYYY-MM-DD');
  const D2 = payCutoff.format('YYYY-MM-DD');

  // 查询按钮：草稿态 → 应用态
  const handleQuery = () => {
    setMode(draftMode);
    setCutoff(draftCutoff);
    setPayCutoff(draftPayCutoff);
  };

  const rows = useMemo<Row[]>(() => {
    if (!open) return [];
    const nameSet = new Set(names.map(trim).filter(Boolean));
    // 账单/收付款中出现但不在名单里的名称也纳入（避免漏债）
    bills.list.forEach(b => { const n = trim(bills.name(b)); if (n) nameSet.add(n); });
    pays.list.forEach(p => { const n = trim(pays.name(p)); if (n) nameSet.add(n); });
    const out: Row[] = [];
    nameSet.forEach(name => {
      const myBills = bills.list.filter(b => trim(bills.name(b)) === name);
      const myPays = pays.list.filter(p => trim(pays.name(p)) === name);
      if (!myBills.length && !myPays.length) return;
      let billAmount = 0; let billCount = 0; let undatedBills = 0;
      myBills.forEach(b => {
        const d = dstr(bills.date(b));
        if (!d) { undatedBills += 1; billAmount += Number(bills.amount(b)) || 0; billCount += 1; return; }
        if (d <= D) { billAmount += Number(bills.amount(b)) || 0; billCount += 1; }
      });
      let payAmount = 0; let payCount = 0; let crossAmount = 0; let undatedPays = 0;
      myPays.forEach(p => {
        const d = dstr(pays.date(p));
        const amt = Number(pays.amount(p)) || 0;
        if (!d) { undatedPays += 1; payAmount += amt; payCount += 1; return; }
        if (mode === 'point') {
          if (d <= D) { payAmount += amt; payCount += 1; }
        } else if (d <= D2) {
          payAmount += amt; payCount += 1;
          if (d > D) crossAmount += amt;
        }
      });
      out.push({
        key: name, name, billCount, billAmount: round2(billAmount), undatedBills,
        payCount, payAmount: round2(payAmount), crossAmount: round2(crossAmount), undatedPays,
        debt: round2(billAmount - payAmount),
      });
    });
    return out.sort((a, b) => b.debt - a.debt);
  }, [open, names, bills, pays, mode, D, D2]);

  const totals = useMemo(() => rows.reduce((s, r) => ({
    bill: round2(s.bill + r.billAmount), pay: round2(s.pay + r.payAmount), debt: round2(s.debt + r.debt),
  }), { bill: 0, pay: 0, debt: 0 }), [rows]);

  const handleExport = () => {
    if (!rows.length) { message.warning('没有可导出的数据'); return; }
    const head = [nameLabel, `${billLabel}笔数`, `${billLabel}金额(≤${D})`, `${payLabel}笔数`, `${payLabel}合计`, mode === 'legacy' ? `跨期冲抵(${D}之后)` : '', debtLabel];
    const lines = rows.map(r => [r.name, r.billCount, r.billAmount.toFixed(2), r.payCount, r.payAmount.toFixed(2), mode === 'legacy' ? r.crossAmount.toFixed(2) : '', r.debt.toFixed(2)]);
    const csv = '\uFEFF' + [head, ...lines].map(l => l.join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title}_${D}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    message.success('已导出 CSV');
  };

  const detail = useMemo(() => {
    if (!detailName) return null;
    const myBills = bills.list
      .filter(b => trim(bills.name(b)) === detailName)
      .map(b => ({ key: bills.no(b) || `${bills.date(b)}-${bills.amount(b)}`, no: bills.no(b) || '-', date: dstr(bills.date(b)) || '无日期', amount: round2(bills.amount(b)) }))
      .filter(r => r.date === '无日期' || r.date <= D)
      .sort((a, b) => a.date.localeCompare(b.date));
    const myPays = pays.list
      .filter(p => trim(pays.name(p)) === detailName)
      .map(p => ({ key: pays.no(p) || `${pays.date(p)}-${pays.amount(p)}`, no: pays.no(p) || '-', date: dstr(pays.date(p)) || '无日期', amount: round2(pays.amount(p)) }))
      .filter(r => (r.date === '无日期' || (mode === 'point' ? r.date <= D : r.date <= D2)))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { myBills, myPays };
  }, [detailName, bills, pays, mode, D, D2]);

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        footer={<Button onClick={onClose}>关闭</Button>}
        width={980}
        title={<span><FileSearchOutlined style={{ marginRight: 8 }} />{title}</span>}
        destroyOnClose
      >
        <Space wrap style={{ marginBottom: 12 }} align="center">
          <Radio.Group value={draftMode} onChange={e => setDraftMode(e.target.value)} size="small" buttonStyle="solid">
            <Radio.Button value="legacy">旧欠残留</Radio.Button>
            <Radio.Button value="point">时点余额</Radio.Button>
          </Radio.Group>
          <Space size={4}>
            <Text style={{ fontSize: 12 }}>{billLabel}截止日</Text>
            <DatePicker size="small" value={draftCutoff} onChange={v => v && setDraftCutoff(v)} allowClear={false} />
          </Space>
          {draftMode === 'legacy' && (
            <Space size={4}>
              <Text style={{ fontSize: 12 }}>{payLabel}截止日</Text>
              <DatePicker size="small" value={draftPayCutoff} onChange={v => v && setDraftPayCutoff(v)} allowClear={false} />
            </Space>
          )}
          <Button size="small" type="primary" icon={<SearchOutlined />} onClick={handleQuery}>查询</Button>
          <Button size="small" icon={<ExportOutlined />} onClick={handleExport}>导出</Button>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {mode === 'legacy'
              ? `口径：${D} 前${billLabel} − 截至 ${D2} 的${payLabel}（${D} 之后的${payLabel}视为先冲旧债）`
              : `口径：截至 ${D} 的${billLabel} − 截至 ${D} 的${payLabel}`}
            ；无日期单据默认计入
          </Text>
        </Space>
        <Table<Row>
          bordered
          size="small"
          rowKey="key"
          dataSource={rows}
          pagination={{ pageSize: 15, showSizeChanger: true, showTotal: t => `共 ${t} 个${nameLabel}` }}
          locale={{ emptyText: '该截止日下没有账单或收付款记录' }}
          columns={[
            { title: nameLabel, dataIndex: 'name', width: 180, render: (v: string) => <a onClick={() => setDetailName(v)}>{v}</a> },
            { title: `${billLabel}笔数`, dataIndex: 'billCount', width: 90, align: 'right', render: (v: number, r) => (<span>{v}{r.undatedBills > 0 && <Tag style={{ marginLeft: 4 }} color="orange">无日期{r.undatedBills}</Tag>}</span>) },
            { title: `${billLabel}金额(≤${D.slice(5)})`, dataIndex: 'billAmount', width: 130, align: 'right', render: (v: number) => `¥${v.toFixed(2)}` },
            { title: `${payLabel}笔数`, dataIndex: 'payCount', width: 90, align: 'right', render: (v: number, r) => (<span>{v}{r.undatedPays > 0 && <Tag style={{ marginLeft: 4 }} color="orange">无日期{r.undatedPays}</Tag>}</span>) },
            { title: `${payLabel}合计`, dataIndex: 'payAmount', width: 120, align: 'right', render: (v: number) => <Text style={{ color: '#52c41a' }}>¥{v.toFixed(2)}</Text> },
            ...(mode === 'legacy' ? [{
              title: `跨期冲抵(${D.slice(5)}后)`, dataIndex: 'crossAmount', width: 130, align: 'right' as const,
              render: (v: number) => v > 0 ? <Tag color="blue">¥{v.toFixed(2)}</Tag> : <Text type="secondary">—</Text>,
            }] : []),
            {
              title: debtLabel, dataIndex: 'debt', width: 130, align: 'right',
              render: (v: number) => <Text strong style={{ color: v > 0 ? '#ff4d4f' : '#52c41a', fontSize: 13 }}>¥{v.toFixed(2)}</Text>,
            },
          ]}
          summary={() => (
            <Table.Summary.Row style={{ background: '#fafafa' }}>
              <Table.Summary.Cell index={0}><Text strong>合计</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={1} />
              <Table.Summary.Cell index={2} align="right"><Text strong>¥{totals.bill.toFixed(2)}</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={3} />
              <Table.Summary.Cell index={4} align="right"><Text strong style={{ color: '#52c41a' }}>¥{totals.pay.toFixed(2)}</Text></Table.Summary.Cell>
              {mode === 'legacy' && <Table.Summary.Cell index={5} />}
              <Table.Summary.Cell index={6} align="right">
                <Text strong style={{ color: totals.debt > 0 ? '#ff4d4f' : '#52c41a', fontSize: 14 }}>¥{totals.debt.toFixed(2)}</Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </Modal>

      {/* 单客户/供应商明细：参与计算的账单与收付款清单 */}
      <Modal
        open={!!detailName}
        onCancel={() => setDetailName(null)}
        footer={<Button onClick={() => setDetailName(null)}>关闭</Button>}
        width={720}
        title={`${detailName || ''} — 截止 ${D} 明细`}
        destroyOnClose
      >
        {detail && (
          <>
            <Text strong style={{ fontSize: 13 }}>{billLabel}（≤{D}，含无日期）</Text>
            <Table size="small" bordered rowKey="key" style={{ marginTop: 6, marginBottom: 12 }}
              columns={[
                { title: '单据号', dataIndex: 'no', key: 'no' },
                { title: '日期', dataIndex: 'date', key: 'date', width: 110 },
                { title: '金额', dataIndex: 'amount', key: 'amount', width: 120, align: 'right' as const, render: (v: number) => `¥${v.toFixed(2)}` },
              ]}
              dataSource={detail.myBills}
              pagination={false}
              scroll={{ y: 220 }}
              locale={{ emptyText: '无账单' }}
            />
            <Text strong style={{ fontSize: 13 }}>{payLabel}（{mode === 'legacy' ? `≤${D2}` : `≤${D}`}，含无日期）</Text>
            <Table size="small" bordered rowKey="key" style={{ marginTop: 6 }}
              columns={[
                { title: '单号', dataIndex: 'no', key: 'no' },
                {
                  title: '日期', dataIndex: 'date', key: 'date', width: 130,
                  render: (v: string) => (<span>{v}{v !== '无日期' && v > D && <Tag color="blue" style={{ marginLeft: 6 }}>跨期冲抵</Tag>}</span>),
                },
                { title: '金额', dataIndex: 'amount', key: 'amount', width: 120, align: 'right' as const, render: (v: number) => <Text style={{ color: '#52c41a' }}>¥{v.toFixed(2)}</Text> },
              ]}
              dataSource={detail.myPays}
              pagination={false}
              scroll={{ y: 200 }}
              locale={{ emptyText: '无收付款' }}
            />
          </>
        )}
      </Modal>
    </>
  );
};

export default AsOfDebtModal;
