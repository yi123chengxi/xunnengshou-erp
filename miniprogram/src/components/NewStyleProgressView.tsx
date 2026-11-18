import { useState } from 'react'
import { View, Text, Input, Picker, Button, Image } from '@tarojs/components'
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
// 码段默认全选 35-44（与 Web openAdd 的 PRESET_SIZES.join(',') 同口径）
const DEFAULT_SIZES = Array.from({ length: 10 }, (_, i) => 35 + i).join(',')

// 新增新款表单字段（与 Web 新增新款弹窗 10 个录入项同序同口径）
interface Field { key: string; label: string; placeholder: string; kind?: 'number'; required?: boolean }
const FORM_FIELDS: Field[] = [
  { key: 'styleCode', label: '货号', placeholder: '如 NBL-0406', required: true },
  { key: 'brand', label: '品牌', placeholder: '下拉选择或输入新增' },
  { key: 'factory', label: '工厂名称', placeholder: '如 丰鹏' },
  { key: 'costPrice', label: '成本价', placeholder: '0.00', kind: 'number' },
  { key: 'color', label: '颜色', placeholder: '多个颜色用空格分隔' },
  { key: 'sizeRange', label: '码段', placeholder: '如 35,36,37 或 35-44' },
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
  const [modeIdx, setModeIdx] = useState(0)
  const [image, setImage] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const cur = TABS.find(t => t.key === tab) || TABS[0]

  const setField = (key: string, val: string) => setForm(prev => ({ ...prev, [key]: val }))

  const openForm = () => {
    setForm({ sizeRange: DEFAULT_SIZES })
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
      await createNewStyle({ ...form, photoThenList: LIST_MODES[modeIdx], image })
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
          {FORM_FIELDS.map(f => (
            <Input
              key={f.key}
              className="input"
              type={f.kind === 'number' ? 'digit' : 'text'}
              placeholder={`${f.label}${f.required ? '*' : ''}：${f.placeholder}`}
              value={form[f.key] || ''}
              onInput={e => setField(f.key, e.detail.value)}
            />
          ))}
          <Picker mode="selector" range={LIST_MODES} value={modeIdx} onChange={e => setModeIdx(Number(e.detail.value))}>
            <View className="row">
              <Text className="muted">何时上架</Text>
              <Text style={{ color: '#1677ff' }}>{LIST_MODES[modeIdx]} ▾</Text>
            </View>
          </Picker>
          <View className="row">
            <Text className="muted">款式图片</Text>
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
