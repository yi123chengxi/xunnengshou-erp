import { useState } from 'react'
import { View, Text, Input, Picker, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { createBookkeeping } from '../services/api'
import ListView from './ListView'

// 预置两级分类与 Web DailyBookkeepingPage 的 INCOME/EXPENSE_HIERARCHY 逐字同口径
const INCOME_MAINS = [
  { name: '主营业务收入', subs: ['销售收入', '销售退货'] },
  { name: '其他业务收入', subs: ['其他收入'] },
  { name: '营业外收入', subs: [] as string[] },
]
const EXPENSE_MAINS = [
  { name: '销售费用', subs: ['采购支出', '差旅费', '运输费', '广告推广费'] },
  { name: '管理费用', subs: ['办公费用', '水电费', '工资社保', '税费'] },
  { name: '财务费用', subs: ['报销', '其他支出'] },
]

const todayStr = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 日常记账：新增记账表单（手机填单）+ 流水列表。
 * 落库口径与 Web 同：凭证号 PZ-YYYYMMDD-XXX、分类「主-子」字符串、
 * 收入侧子分类含「退货」记负数、已结转月份服务端拒写。
 */
const BookkeepingView = ({ tick = 0 }: { tick?: number }) => {
  const [formVisible, setFormVisible] = useState(false)
  const [typeIdx, setTypeIdx] = useState(0)
  const [mainIdx, setMainIdx] = useState(0)
  const [subIdx, setSubIdx] = useState(-1)
  const [date, setDate] = useState(todayStr())
  const [amount, setAmount] = useState('')
  const [account, setAccount] = useState('')
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  const mains = typeIdx === 0 ? INCOME_MAINS : EXPENSE_MAINS
  const subs = mains[mainIdx]?.subs || []

  const submit = async () => {
    if (busy) return
    const amt = Number(amount)
    if (!(amt > 0)) {
      Taro.showToast({ title: '请输入大于 0 的金额', icon: 'none' })
      return
    }
    setBusy(true)
    try {
      await createBookkeeping({
        bookDate: date,
        bookType: typeIdx === 0 ? '收入' : '支出',
        mainCategory: mains[mainIdx].name,
        subCategory: subIdx >= 0 ? subs[subIdx] : '',
        amount: amt,
        account: account.trim(),
        remark: remark.trim(),
      })
      Taro.showToast({ title: '记账已保存', icon: 'success' })
      setFormVisible(false)
      setAmount('')
      setAccount('')
      setRemark('')
      setSubIdx(-1)
      setReload(v => v + 1)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <View>
      {formVisible && (
        <View className="card">
          <Picker mode="date" value={date} onChange={e => setDate(e.detail.value)}>
            <View className="row">
              <Text className="muted">记账日期</Text>
              <Text style={{ color: '#1677ff' }}>{date} ▾</Text>
            </View>
          </Picker>
          <View className="row">
            <Text className="muted">收支类型</Text>
            <View style={{ display: 'flex' }}>
              <Text
                className={`tag ${typeIdx === 0 ? 'tag-green' : 'tag-gray'}`}
                style={{ marginRight: 12, fontSize: 26, lineHeight: '44px', padding: '0 24px' }}
                onClick={() => { setTypeIdx(0); setMainIdx(0); setSubIdx(-1) }}
              >
                收入
              </Text>
              <Text
                className={`tag ${typeIdx === 1 ? 'tag-red' : 'tag-gray'}`}
                style={{ fontSize: 26, lineHeight: '44px', padding: '0 24px' }}
                onClick={() => { setTypeIdx(1); setMainIdx(0); setSubIdx(-1) }}
              >
                支出
              </Text>
            </View>
          </View>
          <Picker
            mode="selector"
            range={mains.map(m => m.name)}
            value={mainIdx}
            onChange={e => { setMainIdx(Number(e.detail.value)); setSubIdx(-1) }}
          >
            <View className="row">
              <Text className="muted">主分类</Text>
              <Text style={{ color: '#1677ff' }}>{mains[mainIdx].name} ▾</Text>
            </View>
          </Picker>
          {subs.length > 0 && (
            <View style={{ display: 'flex', flexWrap: 'wrap', padding: '4px 0 12px' }}>
              {subs.map((s, i) => (
                <Text
                  key={s}
                  className={`tag ${subIdx === i ? (s.includes('退货') ? 'tag-red' : 'tag-blue') : 'tag-gray'}`}
                  style={{ marginRight: 12, marginBottom: 12, fontSize: 26, lineHeight: '44px', padding: '0 24px' }}
                  onClick={() => setSubIdx(subIdx === i ? -1 : i)}
                >
                  {s}
                </Text>
              ))}
            </View>
          )}
          <Input className="input" type="digit" placeholder="金额（元）" value={amount} onInput={e => setAmount(e.detail.value)} />
          <Input
            className="input"
            placeholder={typeIdx === 0 ? '收款账户（选填）' : '付款账户（选填）'}
            value={account}
            onInput={e => setAccount(e.detail.value)}
          />
          <Input className="input" placeholder="备注（选填）" value={remark} onInput={e => setRemark(e.detail.value)} />
          <Button className="btn-primary" loading={busy} onClick={submit}>保存记账</Button>
        </View>
      )}
      {/* 紧凑列表模式；新增入口移到查询行（查询右侧）的「新增记账」小按键 */}
      <ListView page="bookkeeping" tick={tick + reload} compact addLabel="新增记账" onAdd={() => setFormVisible(v => !v)} />
    </View>
  )
}

export default BookkeepingView
