import { useState } from 'react'
import { View, Text, Input, Picker, Button, Image, Checkbox, CheckboxGroup } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { createNewStyle } from '../services/api'
import { chooseAndUploadImage } from '../services/upload'
import ListView from './ListView'

// 与 Web NewStyleProgressPage 四页签同构：主表单/回传图片/到货款式/商品属性
const TABS = [
  { key: 'progress', label: '主表单', page: 'progress' },
  { key: 'photo', label: '回传图片', page: 'newstylePhoto' },
  { key: 'arrival', label: '到货款式', page: 'newstyleArrival' },
  { key: 'listing', label: '商品属性', page: 'newstyleListing' },
] as const

type TabKey = (typeof TABS)[number]['key']

// 各页签横向表头（与服务器下发 row 单元格顺序对应）
const HEADERS: Record<TabKey, string[]> = {
  progress: ['货号', '品牌', '数据完善', '创建人'],
  photo: ['货号', '图片接收', '预计上架', '创建人'],
  arrival: ['货号', '日期', '到货情况', '创建人'],
  listing: ['货号', '数据完善', '上架平台', '创建人'],
}

// 何时上架三态（与 Web 新增新款弹窗 Select 同选项）
const LIST_MODES = ['拍完上架', '到货上架', '只拍不上架']
// 规格预设 33-46 勾选式录入（存储仍为逗号列表，与 Web 码段同载体）；打开表单默认全选
const PRESET_SIZES = Array.from({ length: 14 }, (_, i) => 33 + i)

// 新增新款表单字段（左标签右输入；规格勾选行插在颜色与制作工艺之间）
interface Field { key: string; label: string; placeholder: string; kind?: 'number'; required?: boolean }
const FIELDS_A: Field[] = [
  { key: 'styleCode', label: '货号', placeholder: '如 NBL-0406', required: true },
  { key: 'brand', label: '品牌', placeholder: '下拉选择或输入新增' },
  { key: 'factory', label: '工厂名称', placeholder: '如 丰鹏' },
  { key: 'costPrice', label: '成本价', placeholder: '0.00', kind: 'number' },
  { key: 'color', label: '颜色', placeholder: '多个颜色用空格分隔' },
]
const FIELDS_B: Field[] = [
  { key: 'craft', label: '制作工艺', placeholder: '下拉选择或输入新增' },
  { key: 'remark', label: '备注', placeholder: '选填' },
]

/**
 * 新款进度：与 Web NewStyleProgressPage 同结构的多子页签移动版，
 * 每个页签以横向表头表格展示与网页软件同一份数据；
 * 主表单页签查询键右侧带「新增新款」手机填单（字段与网页版一致）。
 */
const NewStyleProgressView = ({ tick = 0 }: { tick?: number }) => {
  const [tab, setTab] = useState<TabKey>('progress')
  const [formVisible, setFormVisible] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [sizes, setSizes] = useState<number[]>(PRESET_SIZES)
  const [modeIdx, setModeIdx] = useState(0)
  const [image, setImage] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const cur = TABS.find(t => t.key === tab) || TABS[0]

  // 左标签右输入的行布局：标签固定宽，输入框自适应填满右侧
  const labelStyle = { width: 150, flexShrink: 0, fontSize: 26, color: '#5a6d85' }
  const fieldRow = (f: Field) => (
    <View key={f.key} style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
      <Text style={labelStyle}>{f.label}{f.required ? '*' : ''}</Text>
      <Input
        className="input"
        style={{ flex: 1, marginBottom: 0 }}
        type={f.kind === 'number' ? 'digit' : 'text'}
        placeholder={f.placeholder}
        value={form[f.key] || ''}
        onInput={e => setField(f.key, e.detail.value)}
      />
    </View>
  )

  const setField = (key: string, val: string) => setForm(prev => ({ ...prev, [key]: val }))

  const openForm = () => {
    setForm({})
    setSizes([...PRESET_SIZES])
    setModeIdx(0)
    setImage('')
    setFormVisible(v => !v)
  }

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
    if (!String(form.styleCode || '').trim()) {
      Taro.showToast({ title: '请填写货号', icon: 'none' })
      return
    }
    setBusy(true)
    try {
      await createNewStyle({ ...form, sizeRange: sizes.join(','), photoThenList: LIST_MODES[modeIdx], image })
      Taro.showToast({ title: '新款已登记', icon: 'success' })
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
            onClick={() => { setTab(t.key); setFormVisible(false) }}
          >
            {t.label}
          </View>
        ))}
      </View>
      {formVisible && tab === 'progress' && (
        <View className="card">
          {FIELDS_A.map(fieldRow)}
          {/* 规格：预设 33-46 每项前置复选框，勾选结果以逗号列表落库 */}
          <View style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 20 }}>
            <Text style={{ ...labelStyle, lineHeight: '48px' }}>规格</Text>
            <CheckboxGroup
              style={{ flex: 1, display: 'flex', flexWrap: 'wrap' }}
              onChange={e => setSizes((e.detail.value || []).map(Number))}
            >
              {PRESET_SIZES.map(n => (
                <View key={n} style={{ display: 'flex', alignItems: 'center', width: '25%', padding: '4px 0' }}>
                  <Checkbox value={String(n)} checked={sizes.includes(n)} />
                  <Text style={{ fontSize: 26 }}>{n}</Text>
                </View>
              ))}
            </CheckboxGroup>
          </View>
          {FIELDS_B.map(fieldRow)}
          <View style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
            <Text style={labelStyle}>何时上架</Text>
            <Picker mode="selector" range={LIST_MODES} value={modeIdx} onChange={e => setModeIdx(Number(e.detail.value))} style={{ flex: 1 }}>
              <View className="input" style={{ marginBottom: 0, color: '#1677ff' }}>{LIST_MODES[modeIdx]} ▾</View>
            </Picker>
          </View>
          <View style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
            <Text style={labelStyle}>款式图片</Text>
            <View style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
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
          <Button className="btn-primary" loading={busy} onClick={submit}>保存新增</Button>
        </View>
      )}
      <ListView
        page={cur.page}
        headers={HEADERS[tab]}
        addLabel={tab === 'progress' ? '新增新款' : undefined}
        onAdd={tab === 'progress' ? openForm : undefined}
        tick={tick + reload}
      />
    </View>
  )
}

export default NewStyleProgressView
