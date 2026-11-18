import { useState } from 'react'
import { View, Text, Input, Picker, Button, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { createWsRecord } from '../services/api'
import { chooseAndUploadImage } from '../services/upload'
import ListView from './ListView'

const TABS = [
  { key: 'stock', label: '备货', page: 'warehouseStock' },
  { key: 'pick', label: '配货', page: 'warehousePick' },
  { key: 'urgent', label: '急采', page: 'warehouseUrgent' },
  { key: 'note', label: '奖惩', page: 'warehouseNote' },
  { key: 'salary', label: '工资汇总', page: 'warehouseSalary' },
] as const

type TabKey = (typeof TABS)[number]['key']

interface Field { key: string; label: string; kind?: 'date' | 'number'; required?: boolean }

// 各页签新增表单字段（落库派生由服务端按 Web 同口径完成）
const FORM_FIELDS: Record<TabKey, Field[]> = {
  stock: [
    { key: 'orderNo', label: '内部单号', required: true },
    { key: 'quantity', label: '数量', kind: 'number', required: true },
  ],
  pick: [
    { key: 'orderNo', label: '内部单号', required: true },
    { key: 'quantity', label: '数量', kind: 'number', required: true },
    { key: 'month', label: '月份 YYYY-MM（默认当月）' },
    { key: 'picker', label: '配货员（默认本人）' },
  ],
  urgent: [
    { key: 'date', label: '日期', kind: 'date' },
    { key: 'orderNo', label: '内部单号', required: true },
    { key: 'productCode', label: '货号' },
    { key: 'quantity', label: '数量', kind: 'number', required: true },
    { key: 'inspector', label: '质检员（默认本人）' },
    { key: 'material', label: '材质（匹配工价）' },
    { key: 'packer', label: '打包员（默认首组）' },
    { key: 'foreignTeam', label: '外贸组长（默认首组）' },
    { key: 'remark', label: '备注' },
  ],
  note: [
    { key: 'person', label: '人员', required: true },
    { key: 'amount', label: '金额（元）', kind: 'number', required: true },
    { key: 'date', label: '日期', kind: 'date' },
    { key: 'note', label: '备注内容', required: true },
  ],
  salary: [],
}

const curMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const todayStr = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 仓库统计：与 Web WarehouseStatsPage 同结构的多子页签移动版
 * （备货/配货/急采/奖惩/工资汇总）；前四页签查询键右侧带「新增记录」手机填单。
 */
const WarehouseStatsView = ({ tick = 0 }: { tick?: number }) => {
  const [tab, setTab] = useState<TabKey>('stock')
  const [month, setMonth] = useState(curMonth())
  const [formVisible, setFormVisible] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [image, setImage] = useState('')
  const [noteType, setNoteType] = useState(0)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const cur = TABS.find(t => t.key === tab) || TABS[0]
  const fields = FORM_FIELDS[tab]

  const setField = (key: string, val: string) => setForm(prev => ({ ...prev, [key]: val }))

  const pickImage = async () => {
    try {
      const url = await chooseAndUploadImage()
      setImage(url)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '上传失败', icon: 'none' })
    }
  }

  const submit = async () => {
    if (busy) return
    for (const f of fields) {
      if (f.required && !String(form[f.key] || '').trim()) {
        Taro.showToast({ title: `请填写${f.label.split('（')[0]}`, icon: 'none' })
        return
      }
    }
    const body: Record<string, any> = { ...form }
    if (tab === 'note') body.type = noteType === 1 ? 'punishment' : 'reward'
    if (tab === 'stock') body.image = image
    setBusy(true)
    try {
      await createWsRecord(tab as 'stock' | 'pick' | 'urgent' | 'note', body)
      Taro.showToast({ title: '已新增', icon: 'success' })
      setFormVisible(false)
      setForm({})
      setImage('')
      setReload(v => v + 1)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '新增失败', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <View>
      <View className="segment" style={{ margin: '16px 24px 0' }}>
        {TABS.map(t => (
          <View
            key={t.key}
            className={`segment-item ${tab === t.key ? 'active' : ''}`}
            onClick={() => { setTab(t.key); setFormVisible(false); setForm({}); setImage('') }}
          >
            {t.label}
          </View>
        ))}
      </View>
      {tab === 'salary' && (
        <View style={{ display: 'flex', padding: '16px 24px 0', alignItems: 'center' }}>
          <Text className="muted" style={{ marginRight: 12, flexShrink: 0 }}>统计月份</Text>
          <Input
            className="input"
            style={{ flex: 1, marginBottom: 0 }}
            placeholder="YYYY-MM"
            value={month}
            onInput={e => setMonth(e.detail.value)}
          />
        </View>
      )}
      {formVisible && fields.length > 0 && (
        <View className="card">
          {tab === 'note' && (
            <View className="row">
              <Text className="muted">类型</Text>
              <View style={{ display: 'flex' }}>
                <Text
                  className={`tag ${noteType === 0 ? 'tag-green' : 'tag-gray'}`}
                  style={{ marginRight: 12, fontSize: 26, lineHeight: '44px', padding: '0 24px' }}
                  onClick={() => setNoteType(0)}
                >
                  奖励
                </Text>
                <Text
                  className={`tag ${noteType === 1 ? 'tag-red' : 'tag-gray'}`}
                  style={{ fontSize: 26, lineHeight: '44px', padding: '0 24px' }}
                  onClick={() => setNoteType(1)}
                >
                  罚款
                </Text>
              </View>
            </View>
          )}
          {tab === 'stock' && (
            <View className="row">
              <Text className="muted">图片</Text>
              <View style={{ display: 'flex', alignItems: 'center' }}>
                {image ? (
                  <Image src={image} mode="aspectFill" style={{ width: 96, height: 96, borderRadius: 8, marginRight: 12 }} />
                ) : null}
                <Button size="mini" className="btn-primary" style={{ lineHeight: '56px', marginRight: 12 }} onClick={pickImage}>
                  {image ? '换图' : '选图上传'}
                </Button>
                {image ? (
                  <Text className="muted" style={{ fontSize: 24 }} onClick={() => setImage('')}>清除</Text>
                ) : null}
              </View>
            </View>
          )}
          {fields.map(f => (
            f.kind === 'date' ? (
              <Picker key={f.key} mode="date" value={form[f.key] || todayStr()} onChange={e => setField(f.key, e.detail.value)}>
                <View className="row">
                  <Text className="muted">{f.label}</Text>
                  <Text style={{ color: '#1677ff' }}>{form[f.key] || todayStr()} ▾</Text>
                </View>
              </Picker>
            ) : (
              <Input
                key={f.key}
                className="input"
                type={f.kind === 'number' ? 'digit' : 'text'}
                placeholder={f.label}
                value={form[f.key] || ''}
                onInput={e => setField(f.key, e.detail.value)}
              />
            )
          ))}
          <Button className="btn-primary" loading={busy} onClick={submit}>保存新增</Button>
        </View>
      )}
      <ListView
        page={cur.page}
        extra={tab === 'salary' ? `m=${encodeURIComponent(month)}` : ''}
        addLabel={fields.length > 0 ? '新增记录' : undefined}
        onAdd={fields.length > 0 ? () => setFormVisible(v => !v) : undefined}
        tick={tick + reload}
      />
    </View>
  )
}

export default WarehouseStatsView
