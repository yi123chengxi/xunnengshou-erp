import { useState } from 'react'
import { View, Text, Input, Picker, Button, Image, Checkbox, CheckboxGroup } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { createNewStyle } from '../services/api'
import { chooseAndUploadImage } from '../services/upload'
import { fullImageUrl } from '../utils/imageUrl'
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
  // 行内 style 的数字按真实 px 渲染（约 2 倍 rpx），所以尺寸属性一律显式带 rpx 单位
  const labelStyle = { width: '150rpx', flexShrink: 0, fontSize: '28rpx', color: '#5a6d85' }
  const fieldRow = (f: Field) => (
    <View key={f.key} style={{ display: 'flex', alignItems: 'center', marginBottom: '20rpx' }}>
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

  // 款式图片：拍照 / 相册两入口（sourceType 只传 camera 则直接进相机，不再弹来源选择）
  const pickImage = async (sourceType: ('album' | 'camera')[]) => {
    try {
      const url = await chooseAndUploadImage(sourceType)
      setImage(url)
    } catch (e: any) {
      const msg = String((e && (e.errMsg || e.message)) || '')
      if (/cancel|取消/i.test(msg)) return
      Taro.showToast({ title: e?.message || '上传失败', icon: 'none' })
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
      {formVisible && tab === 'progress' ? (
        /* 新增窗口独立：填单时整页只呈现表单（下方列表隐藏），保存或点「返回列表」后回到列表 */
        <View className="card" style={{ margin: '20rpx 24rpx', padding: '24rpx' }}>
          <View style={{ display: 'flex', alignItems: 'center', marginBottom: '24rpx' }}>
            <Text style={{ flex: 1, fontSize: '30rpx', fontWeight: 600 }}>新增新款</Text>
            <Text style={{ fontSize: '26rpx', color: '#1677ff' }} onClick={() => setFormVisible(false)}>返回列表 ›</Text>
          </View>
          {FIELDS_A.map(fieldRow)}
          {/* 规格：预设 33-46 每项前置复选框，勾选结果以逗号列表落库；字号用 rpx 以免撑破 25% 列宽 */}
          <View style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '20rpx' }}>
            <Text style={{ ...labelStyle, lineHeight: '56rpx' }}>规格</Text>
            <CheckboxGroup
              style={{ flex: 1, display: 'flex', flexWrap: 'wrap' }}
              onChange={e => setSizes((e.detail.value || []).map(Number))}
            >
              {PRESET_SIZES.map(n => (
                <View key={n} style={{ display: 'flex', alignItems: 'center', width: '25%', padding: '4rpx 0' }}>
                  <Checkbox value={String(n)} checked={sizes.includes(n)} />
                  <Text style={{ fontSize: '26rpx', marginLeft: '4rpx' }}>{n}</Text>
                </View>
              ))}
            </CheckboxGroup>
          </View>
          {FIELDS_B.map(fieldRow)}
          <View style={{ display: 'flex', alignItems: 'center', marginBottom: '20rpx' }}>
            <Text style={labelStyle}>何时上架</Text>
            <Picker mode="selector" range={LIST_MODES} value={modeIdx} onChange={e => setModeIdx(Number(e.detail.value))} style={{ flex: 1 }}>
              <View className="input" style={{ marginBottom: 0, color: '#1677ff' }}>{LIST_MODES[modeIdx]} ▾</View>
            </Picker>
          </View>
          {/* 款式图片：拍照上传 + 相册选图；weapp 下服务端回传相对路径须经 fullImageUrl 归一才能渲染 */}
          <View style={{ display: 'flex', alignItems: 'center', marginBottom: '24rpx' }}>
            <Text style={labelStyle}>款式图片</Text>
            <View style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
              {image ? (
                <Image src={fullImageUrl(image)} mode="aspectFill" style={{ width: '120rpx', height: '120rpx', borderRadius: '8rpx', marginRight: '16rpx' }} />
              ) : null}
              <View
                style={{ height: '64rpx', lineHeight: '64rpx', padding: '0 24rpx', fontSize: '28rpx', color: '#fff', background: '#1677ff', borderRadius: '8rpx', marginRight: '16rpx', flexShrink: 0, boxSizing: 'border-box' }}
                onClick={() => pickImage(['camera'])}
              >
                拍照
              </View>
              <View
                style={{ height: '64rpx', lineHeight: '64rpx', padding: '0 24rpx', fontSize: '28rpx', color: '#1677ff', background: '#e6f4ff', borderRadius: '8rpx', marginRight: '16rpx', flexShrink: 0, boxSizing: 'border-box' }}
                onClick={() => pickImage(['album'])}
              >
                相册
              </View>
              {image ? (
                <Text className="muted" style={{ fontSize: '26rpx' }} onClick={() => setImage('')}>清除</Text>
              ) : null}
            </View>
          </View>
          <Button className="btn-primary" loading={busy} onClick={submit}>保存新增</Button>
        </View>
      ) : (
        <ListView
          page={cur.page}
          headers={HEADERS[tab]}
          addLabel={tab === 'progress' ? '新增新款' : undefined}
          onAdd={tab === 'progress' ? openForm : undefined}
          tick={tick + reload}
        />
      )}
    </View>
  )
}

export default NewStyleProgressView
