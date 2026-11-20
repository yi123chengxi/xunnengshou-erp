import { useState, useEffect } from 'react'
import { View, Text, Input, Picker, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { createWsRecord, getWsMaterials, getWsRecord, updateWsRecord } from '../services/api'
import { chooseAndUploadImage } from '../services/upload'
import { fullImageUrl } from '../utils/imageUrl'
import ListView from './ListView'

const TABS = [
  { key: 'stock', label: '备货', page: 'warehouseStock' },
  { key: 'pick', label: '配货', page: 'warehousePick' },
  { key: 'urgent', label: '急采', page: 'warehouseUrgent' },
  { key: 'note', label: '奖惩', page: 'warehouseNote' },
  { key: 'salary', label: '工资汇总', page: 'warehouseSalary' },
] as const

type TabKey = (typeof TABS)[number]['key']

interface Field { key: string; label: string; kind?: 'date' | 'number' | 'material'; required?: boolean }

// 各页签新增表单字段（落库派生由服务端按 Web 同口径完成）
const FORM_FIELDS: Record<TabKey, Field[]> = {
  stock: [
    { key: 'orderNo', label: '内部单号', required: true },
    { key: 'quantity', label: '数量', kind: 'number', required: true },
    { key: 'material', label: '鞋子材质', kind: 'material' },
  ],
  pick: [
    { key: 'orderNo', label: '内部单号', required: true },
    { key: 'quantity', label: '数量', kind: 'number', required: true },
    { key: 'month', label: '月份 YYYY-MM（默认当月）' },
    { key: 'picker', label: '配货员（默认本人）' },
  ],
  urgent: [
    { key: 'orderNo', label: '内部单号', required: true },
    { key: 'quantity', label: '数量', kind: 'number', required: true },
    { key: 'material', label: '鞋子材质', kind: 'material' },
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

// 横向表格表头（与服务器下发 row 单元格顺序对应）；空数组=卡片模式
const HEADERS: Record<TabKey, string[]> = {
  stock: ['内部单号', '数量', '鞋子材质', '质检工资'],
  pick: ['内部单号', '数量', '计件工资'],
  urgent: ['内部单号', '数量', '鞋子材质', '质检工资'],
  note: ['人员', '类型', '金额'],
  salary: [],
}
const todayStr = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// 选择/图片类字段行：与 .input 输入框同底色并补一圈灰边框（.row 类本身无边框，
// 且类里的 padding 会压过行内值，故整行改纯行内声明）
const PICKER_ROW = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  background: '#f5f6f8', border: '1px solid #c9d1da', borderRadius: '12rpx',
  padding: '16rpx 20rpx', marginBottom: '20rpx', boxSizing: 'border-box',
} as const

// 详情/编辑弹窗字段（k=ro/money 只读，其余可录入；src 为落库字段名，与 Web 记录结构同名）
interface DField { key: string; label: string; k?: 'text' | 'number' | 'date' | 'material' | 'money' | 'type' | 'image' | 'ro'; src?: string; required?: boolean }

const DETAIL_FIELDS: Record<TabKey, DField[]> = {
  stock: [
    { key: 'orderNo', label: '内部单号', k: 'text', required: true },
    { key: 'quantity', label: '数量', k: 'number', required: true },
    { key: 'material', label: '鞋子材质', k: 'material' },
    { key: 'qcWage', label: '质检工资', k: 'money' },
    { key: 'priceRate', label: '质检工价', k: 'money' },
    { key: 'packWage', label: '打包工资', k: 'money' },
    { key: 'commission', label: '外贸提成', k: 'money' },
    { key: 'date', label: '日期', k: 'date' },
    { key: 'month', label: '月份', k: 'ro' },
    { key: 'inspector', label: '质检员', k: 'text', src: 'qcInspector' },
    { key: 'packer', label: '打包员', k: 'text' },
    { key: 'foreignTeam', label: '外贸组长', k: 'text' },
    { key: 'productCode', label: '货号', k: 'text' },
    { key: 'remark', label: '备注', k: 'text' },
    { key: 'image', label: '图片', k: 'image' },
    { key: 'creator', label: '创建人', k: 'ro' },
    { key: 'lastEditor', label: '最后修改', k: 'ro' },
  ],
  pick: [
    { key: 'orderNo', label: '内部单号', k: 'text', required: true },
    { key: 'quantity', label: '数量', k: 'number', required: true },
    { key: 'wage', label: '计件工资', k: 'money' },
    { key: 'priceRate', label: '统一工价', k: 'money' },
    { key: 'picker', label: '配货员', k: 'text' },
    { key: 'month', label: '月份 YYYY-MM', k: 'text' },
    { key: 'createdAt', label: '登记时间', k: 'ro' },
    { key: 'creator', label: '创建人', k: 'ro' },
  ],
  urgent: [
    { key: 'orderNo', label: '内部单号', k: 'text', required: true },
    { key: 'quantity', label: '数量', k: 'number', required: true },
    { key: 'material', label: '鞋子材质', k: 'material' },
    { key: 'wage', label: '质检工资', k: 'money' },
    { key: 'priceRate', label: '质检工价', k: 'money' },
    { key: 'packWage', label: '打包工资', k: 'money' },
    { key: 'commission', label: '外贸提成', k: 'money' },
    { key: 'date', label: '质检日期', k: 'date' },
    { key: 'month', label: '月份', k: 'ro' },
    { key: 'inspector', label: '质检员', k: 'text' },
    { key: 'packer', label: '打包员', k: 'text' },
    { key: 'foreignTeam', label: '外贸组长', k: 'text' },
    { key: 'productCode', label: '货号', k: 'text' },
    { key: 'remark', label: '备注', k: 'text' },
    { key: 'image', label: '图片', k: 'image' },
    { key: 'creator', label: '创建人', k: 'ro' },
    { key: 'lastEditor', label: '最后修改', k: 'ro' },
  ],
  note: [
    { key: 'person', label: '人员', k: 'text', required: true },
    { key: 'type', label: '类型', k: 'type' },
    { key: 'amount', label: '金额（元）', k: 'number', required: true },
    { key: 'date', label: '日期', k: 'date' },
    { key: 'month', label: '月份', k: 'ro' },
    { key: 'note', label: '备注内容', k: 'text', required: true },
  ],
  salary: [],
}

/** 详情只读取值：工资按 ¥ 两位小数、奖惩类型与时间类字段同 Web 文案 */
const detailVal = (f: DField, rec: any): string => {
  const raw = rec[f.src || f.key]
  if (f.k === 'money') return Number(raw) ? `¥${Number(raw).toFixed(2)}` : '—'
  if (f.k === 'type') return rec.type === 'punishment' ? '罚款' : '奖励'
  if (f.key === 'lastEditor') return [rec.lastEditor, String(rec.lastEditTime || '').slice(0, 10)].filter(Boolean).join(' ') || '—'
  if (f.key === 'createdAt') return String(rec.createdAt || '').slice(0, 10) || '—'
  return String(raw ?? '').trim() || '—'
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
  const [materials, setMaterials] = useState<string[]>([])
  const [detail, setDetail] = useState<any | null>(null)
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [editBusy, setEditBusy] = useState(false)
  const cur = TABS.find(t => t.key === tab) || TABS[0]
  const fields = FORM_FIELDS[tab]

  // 材质下拉候选：新增窗与详情编辑窗都要拉（工价表 ∪ 已有记录去重，与 Web 同源）
  useEffect(() => {
    if (tab !== 'stock' && tab !== 'urgent') return
    if (!formVisible && !editing) return
    getWsMaterials(tab)
      .then(d => setMaterials(d.materials || []))
      .catch(() => setMaterials([]))
  }, [formVisible, editing, tab])

  const setField = (key: string, val: string) => setForm(prev => ({ ...prev, [key]: val }))

  // 选图：['camera'] 直接进相机，['album'] 走相册（与新款进度录入同口径）；用户取消不当错误弹提
  const pickImage = async (sourceType: ('album' | 'camera')[]) => {
    try {
      const url = await chooseAndUploadImage(sourceType)
      setImage(url)
    } catch (e: any) {
      const msg = String((e && (e.errMsg || e.message)) || '')
      if (/cancel|取消/i.test(msg)) return
      Taro.showToast({ title: e.message || '上传失败', icon: 'none' })
    }
  }

  const submit = async (then: 'back' | 'stay') => {
    if (busy) return
    for (const f of fields) {
      if (f.required && !String(form[f.key] || '').trim()) {
        Taro.showToast({ title: `请填写${f.label.split('（')[0]}`, icon: 'none' })
        return
      }
    }
    const body: Record<string, any> = { ...form }
    if (tab === 'note') body.type = noteType === 1 ? 'punishment' : 'reward'
    if (tab === 'stock' || tab === 'urgent') body.image = image
    setBusy(true)
    try {
      await createWsRecord(tab as 'stock' | 'pick' | 'urgent' | 'note', body)
      Taro.showToast({ title: '已新增', icon: 'success' })
      // 保存并返回：关窗回列表；保存并继续：留在填单页清空字段接着录下一条
      if (then === 'back') setFormVisible(false)
      setForm({})
      setImage('')
      setReload(v => v + 1)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '新增失败', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  // 记录行任意位置点开详情：向服务端取原始记录（未部署时提示而非白屏）
  const openDetail = async (it: { key: string }) => {
    if (tab === 'salary') return
    try {
      const d = await getWsRecord(tab as 'stock' | 'pick' | 'urgent' | 'note', String(it.key))
      if (!d.record) {
        // 布局预览模式下未部署的只读接口会静默回落空形状，此处显式提示避免“点了没反应”
        Taro.showToast({ title: '详情接口尚未部署上线', icon: 'none' })
        return
      }
      setDetail(d.record)
      setEditing(false)
      setEdit({})
    } catch (e: any) {
      Taro.showToast({ title: e.message || '详情加载失败（需服务端更新后使用）', icon: 'none' })
    }
  }

  // 进编辑态：可录入字段从详情记录回显（工资/只读字段不进表单，由服务端重算）
  const startEdit = () => {
    const e: Record<string, string> = {}
    for (const f of DETAIL_FIELDS[tab]) {
      if (f.k === 'ro' || f.k === 'money') continue
      if (f.k === 'image') { e.image = String(detail?.image || ''); continue }
      if (f.k === 'type') { e.type = detail?.type === 'punishment' ? 'punishment' : 'reward'; continue }
      e[f.key] = String(detail?.[f.src || f.key] ?? '')
    }
    setEdit(e)
    setEditing(true)
  }

  const saveEdit = async () => {
    if (editBusy || !detail) return
    for (const f of DETAIL_FIELDS[tab]) {
      if (f.required && !String(edit[f.key] || '').trim()) {
        Taro.showToast({ title: `请填写${f.label.split('（')[0]}`, icon: 'none' })
        return
      }
    }
    const body: Record<string, any> = {}
    for (const f of DETAIL_FIELDS[tab]) {
      if (f.k === 'ro' || f.k === 'money') continue
      body[f.key] = f.k === 'number' ? Number(edit[f.key]) || 0 : String(edit[f.key] || '').trim()
    }
    setEditBusy(true)
    try {
      const d = await updateWsRecord(tab as 'stock' | 'pick' | 'urgent' | 'note', String(detail.key), body)
      setDetail(d.record || detail)
      setEditing(false)
      setReload(v => v + 1)
      Taro.showToast({ title: '已保存', icon: 'success' })
    } catch (e: any) {
      Taro.showToast({ title: e.message || '保存失败', icon: 'none' })
    } finally {
      setEditBusy(false)
    }
  }

  const pickEditImage = async (sourceType: ('album' | 'camera')[]) => {
    try {
      const url = await chooseAndUploadImage(sourceType)
      setEdit(p => ({ ...p, image: url }))
    } catch (e: any) {
      const msg = String((e && (e.errMsg || e.message)) || '')
      if (/cancel|取消/i.test(msg)) return
      Taro.showToast({ title: e.message || '上传失败', icon: 'none' })
    }
  }

  // 编辑态控件：按字段类型给奖惩切换/日期选择/材质下拉/文本输入
  const editCell = (f: DField) => {
    const v = edit[f.key] || ''
    const setV = (val: string) => setEdit(p => ({ ...p, [f.key]: val }))
    if (f.k === 'type') {
      return (
        <View style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Text
            style={{ fontSize: '26rpx', lineHeight: '44rpx', padding: '0 20rpx', marginRight: '12rpx', borderRadius: '6rpx', color: v === 'reward' ? '#fff' : '#5a6d85', background: v === 'reward' ? '#52c41a' : '#eef1f5' }}
            onClick={() => setV('reward')}
          >
            奖励
          </Text>
          <Text
            style={{ fontSize: '26rpx', lineHeight: '44rpx', padding: '0 20rpx', borderRadius: '6rpx', color: v === 'punishment' ? '#fff' : '#5a6d85', background: v === 'punishment' ? '#ff4d4f' : '#eef1f5' }}
            onClick={() => setV('punishment')}
          >
            罚款
          </Text>
        </View>
      )
    }
    if (f.k === 'date') {
      return (
        <Picker mode="date" value={v || todayStr()} onChange={e => setV(e.detail.value)} style={{ flex: 1 }}>
          <Text style={{ display: 'block', textAlign: 'right', fontSize: '28rpx', color: '#1677ff' }}>{v || todayStr()} ▾</Text>
        </Picker>
      )
    }
    if (f.k === 'material') {
      return (
        <Picker
          mode="selector"
          range={materials.length ? materials : ['暂无材质，请先在网页版工价管理新增']}
          value={Math.max(0, materials.indexOf(v))}
          onChange={e => setV(materials[Number(e.detail.value)] || '')}
          style={{ flex: 1 }}
        >
          <Text style={{ display: 'block', textAlign: 'right', fontSize: '28rpx', color: v ? '#1f2733' : '#1677ff' }}>{v || '选择材质'} ▾</Text>
        </Picker>
      )
    }
    return (
      <Input
        style={{ flex: 1, marginBottom: 0, textAlign: 'right', fontSize: '28rpx', color: '#1f2733' }}
        type={f.k === 'number' ? 'digit' : 'text'}
        placeholder={f.label}
        value={v}
        onInput={e => setV(e.detail.value)}
      />
    )
  }

  return (
    <View>
      {/* 页签菜单栏：每个按键自带描边，选中蓝底白字（不挂全局 .segment 类，避免与商机市场三切换互相干扰） */}
      <View style={{ display: 'flex', margin: '12px 24px 0' }}>
        {TABS.map((t, i) => {
          const on = tab === t.key
          return (
            <View
              key={t.key}
              style={{
                flex: 1, minWidth: 0, marginLeft: i ? 6 : 0, height: 32, lineHeight: '32px',
                textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', fontSize: 14,
                borderRadius: 8, boxSizing: 'border-box',
                border: on ? '1px solid #1677ff' : '1px solid #c9d1da',
                background: on ? '#1677ff' : '#fff', color: on ? '#fff' : '#5a6d85',
              }}
              onClick={() => { setTab(t.key); setFormVisible(false); setForm({}); setImage(''); setDetail(null) }}
            >
              {t.label}
            </View>
          )
        })}
      </View>
      {/* 统计月份：只占一行，上贴页签栏、下贴搜索框；点框弹月份选择器（与 Web 同 mode=date fields=month） */}
      {tab === 'salary' && (
        <View style={{ display: 'flex', padding: '6px 24px 0', alignItems: 'center' }}>
          <Text style={{ marginRight: 10, flexShrink: 0, fontSize: 15, lineHeight: '24px', color: '#8a94a6' }}>统计月份</Text>
          <Picker
            mode="date"
            fields="month"
            value={month}
            onChange={e => setMonth(String(e.detail.value).slice(0, 7))}
            style={{ flex: 1 }}
          >
            <View style={{ height: 24, boxSizing: 'border-box', border: '1px solid #c9d1da', borderRadius: 6, background: '#fff', padding: '0 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 15, lineHeight: '22px', color: '#1f2733' }}>{month || '选择月份'}</Text>
              <Text style={{ fontSize: 12, lineHeight: '22px', color: '#9aa3ad' }}>▾</Text>
            </View>
          </Picker>
        </View>
      )}
      {formVisible && fields.length > 0 ? (
        /* 填单态：整页只呈现新增表单（下方列表隐藏），保存或点「返回列表」后回到列表 */
        <View className="card">
          <View style={{ display: 'flex', alignItems: 'center', marginBottom: '20rpx' }}>
            <Text style={{ flex: 1, fontSize: '30rpx', fontWeight: 600 }}>新增{cur.label}</Text>
            <Text style={{ fontSize: '26rpx', color: '#1677ff' }} onClick={() => { setFormVisible(false); setForm({}); setImage('') }}>返回列表 ›</Text>
          </View>
          {tab === 'note' && (
            <View style={PICKER_ROW}>
              <Text style={{ fontSize: '26rpx', color: '#5a6d85' }}>类型</Text>
              <View style={{ display: 'flex' }}>
                <Text
                  style={{ marginRight: '12rpx', fontSize: '26rpx', lineHeight: '44rpx', padding: '0 24rpx', borderRadius: '6rpx', color: noteType === 0 ? '#fff' : '#5a6d85', background: noteType === 0 ? '#52c41a' : '#eef1f5' }}
                  onClick={() => setNoteType(0)}
                >
                  奖励
                </Text>
                <Text
                  style={{ fontSize: '26rpx', lineHeight: '44rpx', padding: '0 24rpx', borderRadius: '6rpx', color: noteType === 1 ? '#fff' : '#5a6d85', background: noteType === 1 ? '#ff4d4f' : '#eef1f5' }}
                  onClick={() => setNoteType(1)}
                >
                  罚款
                </Text>
              </View>
            </View>
          )}
          {(tab === 'stock' || tab === 'urgent') && (
            /* 图片行：拍照与相册两个独立入口（weapp 下预览须经 fullImageUrl 归一才能渲染） */
            <View style={PICKER_ROW}>
              <Text style={{ fontSize: '26rpx', color: '#5a6d85' }}>图片</Text>
              <View style={{ display: 'flex', alignItems: 'center' }}>
                {image ? (
                  <Image src={fullImageUrl(image)} mode="aspectFill" style={{ width: '88rpx', height: '88rpx', borderRadius: '8rpx', marginRight: '16rpx' }} />
                ) : null}
                <View
                  style={{ height: '60rpx', lineHeight: '60rpx', padding: '0 22rpx', fontSize: '26rpx', color: '#fff', background: '#1677ff', borderRadius: '8rpx', marginRight: '12rpx', flexShrink: 0, boxSizing: 'border-box' }}
                  onClick={() => pickImage(['camera'])}
                >
                  拍照
                </View>
                <View
                  style={{ height: '60rpx', lineHeight: '60rpx', padding: '0 22rpx', fontSize: '26rpx', color: '#1677ff', background: '#e6f4ff', borderRadius: '8rpx', marginRight: '12rpx', flexShrink: 0, boxSizing: 'border-box' }}
                  onClick={() => pickImage(['album'])}
                >
                  相册
                </View>
                {image ? (
                  <Text style={{ fontSize: '26rpx', color: '#9aa3ad' }} onClick={() => setImage('')}>清除</Text>
                ) : null}
              </View>
            </View>
          )}
          {fields.map(f => (
            f.kind === 'date' ? (
              <Picker key={f.key} mode="date" value={form[f.key] || todayStr()} onChange={e => setField(f.key, e.detail.value)}>
                <View style={PICKER_ROW}>
                  <Text style={{ fontSize: '26rpx', color: '#5a6d85' }}>{f.label}</Text>
                  <Text style={{ fontSize: '28rpx', color: '#1677ff' }}>{form[f.key] || todayStr()} ▾</Text>
                </View>
              </Picker>
            ) : f.kind === 'material' ? (
              /* 鞋子材质：点击下拉选择，候选与网页版材质字段同源 */
              <Picker
                key={f.key}
                mode="selector"
                range={materials.length ? materials : ['暂无材质，请先在网页版工价管理新增']}
                value={Math.max(0, materials.indexOf(form[f.key] || ''))}
                onChange={e => setField(f.key, materials[Number(e.detail.value)] || '')}
              >
                <View style={PICKER_ROW}>
                  <Text style={{ fontSize: '26rpx', color: '#5a6d85' }}>{f.label}</Text>
                  <Text style={{ fontSize: '28rpx', color: form[f.key] ? '#1f2733' : '#1677ff' }}>{form[f.key] || '选择材质'} ▾</Text>
                </View>
              </Picker>
            ) : (
              <Input
                key={f.key}
                className="input"
                style={{ border: '1px solid #c9d1da' }}
                type={f.kind === 'number' ? 'digit' : 'text'}
                placeholder={f.label}
                value={form[f.key] || ''}
                onInput={e => setField(f.key, e.detail.value)}
              />
            )
          ))}
          {/* 保存拆两键：左「保存并返回」存完关窗回列表，右「保存并继续」存完留在本页清空接着录 */}
          <View style={{ display: 'flex' }}>
            <View
              style={{ flex: 1, height: '72rpx', lineHeight: '72rpx', textAlign: 'center', fontSize: '28rpx', color: '#fff', background: '#1677ff', borderRadius: '8rpx', boxSizing: 'border-box', opacity: busy ? 0.6 : 1 }}
              onClick={() => submit('back')}
            >
              保存并返回
            </View>
            <View
              style={{ flex: 1, marginLeft: '20rpx', height: '72rpx', lineHeight: '72rpx', textAlign: 'center', fontSize: '28rpx', color: '#1677ff', background: '#e6f4ff', borderRadius: '8rpx', boxSizing: 'border-box', opacity: busy ? 0.6 : 1 }}
              onClick={() => submit('stay')}
            >
              保存并继续
            </View>
          </View>
        </View>
      ) : (
        /* 列表态：填单态下整块隐藏，避免表单与下方表格同屏拥挤 */
        <ListView
          key={cur.page}
          page={cur.page}
          extra={tab === 'salary' ? `m=${encodeURIComponent(month)}` : ''}
          headers={HEADERS[tab]}
          quick={tab === 'stock' || tab === 'pick' || tab === 'urgent'}
          quickDate={tab === 'pick' ? 'last' : 'first'}
          addLabel={fields.length > 0 ? '新增记录' : undefined}
          onAdd={fields.length > 0 ? () => setFormVisible(true) : undefined}
          onRowClick={tab === 'salary' ? undefined : openDetail}
          padTop={tab === 'salary' ? 6 : 16}
          tick={tick + reload}
        />
      )}
      {/* 记录详情底部弹层：点遮罩或关闭收起；底部「编辑」切到同字段的录入态 */}
      {detail && (
        <View
          style={{ position: 'fixed', left: 0, right: 0, top: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300 }}
          onClick={() => setDetail(null)}
        >
          <View
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: '#fff', borderRadius: '16rpx 16rpx 0 0', padding: '24rpx 24rpx calc(24rpx + env(safe-area-inset-bottom))', maxHeight: '78vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <View style={{ display: 'flex', alignItems: 'center', marginBottom: '12rpx' }}>
              <Text style={{ flex: 1, fontSize: '30rpx', fontWeight: 600 }}>{cur.label}记录详情</Text>
              <Text style={{ fontSize: '26rpx', color: '#1677ff' }} onClick={() => setDetail(null)}>关闭 ✕</Text>
            </View>
            {DETAIL_FIELDS[tab].map(f => {
              const img = String((editing ? edit.image : detail.image) || '')
              const ro = f.k === 'ro' || f.k === 'money'
              return (
                <View key={f.key} style={{ display: 'flex', alignItems: 'center', padding: '14rpx 0', borderBottom: '1px solid #f0f2f5' }}>
                  <Text style={{ width: '180rpx', flexShrink: 0, fontSize: '26rpx', color: '#5a6d85' }}>{f.label}</Text>
                  {f.k === 'image' ? (
                    <View style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                      {img ? (
                        <Image src={fullImageUrl(img)} mode="aspectFill" style={{ width: '120rpx', height: '120rpx', borderRadius: '8rpx', marginRight: '16rpx' }} />
                      ) : null}
                      {editing ? (
                        <View style={{ display: 'flex', alignItems: 'center' }}>
                          <View
                            style={{ height: '56rpx', lineHeight: '56rpx', padding: '0 20rpx', fontSize: '26rpx', color: '#fff', background: '#1677ff', borderRadius: '8rpx', marginRight: '12rpx', boxSizing: 'border-box' }}
                            onClick={() => pickEditImage(['camera'])}
                          >
                            拍照
                          </View>
                          <View
                            style={{ height: '56rpx', lineHeight: '56rpx', padding: '0 20rpx', fontSize: '26rpx', color: '#1677ff', background: '#e6f4ff', borderRadius: '8rpx', boxSizing: 'border-box' }}
                            onClick={() => pickEditImage(['album'])}
                          >
                            相册
                          </View>
                        </View>
                      ) : img ? null : (
                        <Text style={{ fontSize: '26rpx', color: '#9aa3ad' }}>无</Text>
                      )}
                      {editing && img ? (
                        <Text style={{ fontSize: '26rpx', color: '#9aa3ad', marginLeft: '16rpx' }} onClick={() => setEdit(p => ({ ...p, image: '' }))}>清除</Text>
                      ) : null}
                    </View>
                  ) : editing && !ro ? (
                    editCell(f)
                  ) : (
                    <Text style={{ flex: 1, textAlign: 'right', fontSize: '28rpx', color: f.k === 'money' && detailVal(f, detail) !== '—' ? '#ff4d4f' : '#1f2733' }}>
                      {detailVal(f, detail)}
                    </Text>
                  )}
                </View>
              )
            })}
            <View style={{ display: 'flex', marginTop: '24rpx' }}>
              {editing ? (
                <View
                  style={{ flex: 1, height: '72rpx', lineHeight: '72rpx', textAlign: 'center', fontSize: '28rpx', color: '#5a6d85', background: '#eef1f5', borderRadius: '8rpx', boxSizing: 'border-box' }}
                  onClick={() => setEditing(false)}
                >
                  取消
                </View>
              ) : null}
              {editing ? (
                <View
                  style={{ flex: 1, marginLeft: '20rpx', height: '72rpx', lineHeight: '72rpx', textAlign: 'center', fontSize: '28rpx', color: '#fff', background: '#1677ff', borderRadius: '8rpx', boxSizing: 'border-box', opacity: editBusy ? 0.6 : 1 }}
                  onClick={saveEdit}
                >
                  保存修改
                </View>
              ) : (
                <View
                  style={{ flex: 1, height: '72rpx', lineHeight: '72rpx', textAlign: 'center', fontSize: '28rpx', color: '#fff', background: '#1677ff', borderRadius: '8rpx', boxSizing: 'border-box' }}
                  onClick={startEdit}
                >
                  编辑
                </View>
              )}
            </View>
          </View>
        </View>
      )}
    </View>
  )
}

export default WarehouseStatsView
