import { useState, useEffect, useMemo } from 'react'
import { View, Text, Image, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getMarket } from '../services/api'
import { computeSubjectFeatures, subjectSimilarity } from '../services/imageSimilarity'
import scanCameraGrayIcon from '../assets/scan-camera-gray.png'

const SEGMENTS = [
  { key: 'semi', label: '发包市场' },
  { key: 'finished', label: '成品市场' },
  { key: 'mold', label: '模具租售' },
] as const

type MarketType = 'semi' | 'finished' | 'mold'

const statusTag = (status: string) => {
  if (status === '待报价' || status === '待确认') return 'tag-orange'
  if (status === '报价中' || status === '已发布') return 'tag-blue'
  if (status === '已关闭') return 'tag-gray'
  return 'tag-green'
}

// 商机市场视图：顶部三切换（默认成品市场），商品双列卡片式展示。
// 与 Web 市场卡片同口径：成品卡不显示简称标题（首行款号标签）、不显示报价/询价数；
// 报价/询价数仅发包市场显示；模具卡左上角租/售角标
const MarketView = ({ fixedType, tick = 0 }: { fixedType?: MarketType; tick?: number }) => {
  const [type, setType] = useState<MarketType>(fixedType || 'finished')
  const [input, setInput] = useState('')
  const [applied, setApplied] = useState('')
  const [refUrl, setRefUrl] = useState('')
  const [scores, setScores] = useState<Record<string, number>>({})
  const [computing, setComputing] = useState(false)
  const [list, setList] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (fixedType) setType(fixedType)
  }, [fixedType])

  useEffect(() => {
    setLoaded(false)
    getMarket(type, applied)
      .then(d => setList(d.list))
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setLoaded(true))
  }, [type, applied, tick])

  // 关键字兜底过滤：与网页版同口径字段；服务端已部署 q 时双重过滤结果一致
  const filtered = useMemo(() => {
    const kw = applied.trim().toLowerCase()
    if (!kw) return list
    return list.filter((r: any) => {
      const hay = type === 'mold'
        ? `${r.title || ''} ${r.moldCode || ''} ${r.spec || ''}`
        : `${r.id || ''} ${r.styleCode || ''} ${r.shortName || ''} ${r.publisherCompany || ''}`
      return hay.toLowerCase().includes(kw)
    })
  }, [list, applied, type])

  // 图片搜索：参考图变化时对当前列表逐张计算相似度（与 Web 同算法），按得分降序
  useEffect(() => {
    if (!refUrl) { setScores({}); return }
    let cancelled = false
    setComputing(true)
    ;(async () => {
      const ref = await computeSubjectFeatures(refUrl)
      if (cancelled) return
      if (!ref.hist.length) { setComputing(false); return }
      const sc: Record<string, number> = {}
      for (const it of filtered) {
        if (cancelled) return
        const f = await computeSubjectFeatures(it.image || '')
        sc[String(it.id)] = f.hist.length ? subjectSimilarity(ref, f) : 0
      }
      if (!cancelled) { setScores(sc); setComputing(false) }
    })()
    return () => { cancelled = true }
  }, [refUrl, filtered])

  const pickImageSearch = async () => {
    try {
      const res = await Taro.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['album', 'camera'] })
      const p = (res.tempFilePaths || [])[0]
      if (p) setRefUrl(p)
    } catch { /* 用户取消 */ }
  }

  const shown = refUrl && Object.keys(scores).length
    ? [...filtered].sort((a, b) => (scores[String(b.id)] || 0) - (scores[String(a.id)] || 0))
    : filtered
  // 搜索行尺寸：输入框与两个按键等高（weapp 下全局类尺寸会压过行内覆盖，故一律纯行内自带全部视觉属性）
  const cellH = 39
  const btnStyle = { marginLeft: 7, height: cellH, lineHeight: `${cellH}px`, padding: '0 11px', fontSize: 17, color: '#fff', background: '#1677ff', borderRadius: 7, textAlign: 'center', flexShrink: 0, boxSizing: 'border-box' } as const
  const inputStyle = { flex: 1, marginBottom: 0, height: cellH, lineHeight: `${cellH}px`, fontSize: 17, padding: '0 11px', background: '#f5f6f8', borderRadius: 7, boxSizing: 'border-box' } as const

  return (
    <View>
      {/* 顶部搜索：关键字与网页版同口径 + 图片搜索 */}
      <View style={{ display: 'flex', padding: '16px 24px 0', alignItems: 'center' }}>
        <Input
          style={inputStyle}
          placeholder="搜索单号/款号/简称/公司"
          placeholderStyle="color:#9aa3ad;font-size:17px"
          value={input}
          onInput={e => setInput(e.detail.value)}
          onConfirm={() => setApplied(input.trim())}
        />
        <View style={btnStyle} onClick={() => setApplied(input.trim())}>
          搜索
        </View>
        {/* 拍照搜索键：只保留中间相机（浅灰）+ 灰色描边，图标不再铺满整键 */}
        <View
          style={{ width: cellH, height: cellH, marginLeft: 7, flexShrink: 0, borderRadius: 7, background: '#fff', border: '1px solid #c9ced6', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={pickImageSearch}
        >
          <Image src={scanCameraGrayIcon} style={{ width: 28, height: 28, display: 'block' }} mode="aspectFit" />
        </View>
      </View>
      {refUrl ? (
        <View style={{ display: 'flex', alignItems: 'center', padding: '8px 24px 0' }}>
          <Image src={refUrl} mode="aspectFill" style={{ width: 72, height: 72, borderRadius: 8 }} />
          <Text className="muted" style={{ marginLeft: 12, fontSize: 22 }}>
            {computing ? '相似度计算中…' : '已按图片相似度排序'}
          </Text>
          <Text style={{ marginLeft: 12, fontSize: 22, color: '#ff4d4f' }} onClick={() => setRefUrl('')}>清除</Text>
        </View>
      ) : null}
      {!fixedType && (
        <View className="segment" style={{ margin: '16px 24px 0' }}>
          {SEGMENTS.map(s => (
            <View key={s.key} className={`segment-item ${type === s.key ? 'active' : ''}`} onClick={() => setType(s.key)}>
              {s.label}
            </View>
          ))}
        </View>
      )}
      {loaded && filtered.length === 0 && <View className="empty">暂无上架信息</View>}
      <View style={{ display: 'flex', flexWrap: 'wrap', padding: '8px 16px 0' }}>
        {shown.map((r: any) => (
          <View key={String(r.id)} style={{ width: '50%', boxSizing: 'border-box', padding: 8 }}>
            <View style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(31,39,51,0.06)', position: 'relative' }}>
              {/* 封面区：padding-top:100% 撑出正方形（H5/weapp 通用，不依赖 aspect-ratio） */}
              <View style={{ position: 'relative', width: '100%', paddingTop: '100%' }}>
                {r.image ? (
                  <Image src={r.image} mode="aspectFill" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
                ) : (
                  <View style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'linear-gradient(135deg,#e6f4ff,#f0f5ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 72 }}>
                    {type === 'mold' ? '🧰' : '🛍️'}
                  </View>
                )}
                {type === 'mold' && r.mode ? (
                  <Text style={{ position: 'absolute', top: 0, left: 0, color: '#fff', fontSize: 20, lineHeight: '32px', padding: '0 14px', borderRadius: '12px 0 12px 0', background: r.mode === '出租' ? 'linear-gradient(135deg,#1677ff,#69b1ff)' : 'linear-gradient(135deg,#52c41a,#95de64)' }}>
                    {r.mode}
                  </Text>
                ) : null}
                {/* 图片搜索相似度角标（与 Web 分档同口径） */}
                {refUrl && scores[String(r.id)] !== undefined ? (
                  <Text
                    style={{
                      position: 'absolute', top: 0, right: 0, color: '#fff', fontSize: 20, lineHeight: '32px',
                      padding: '0 14px', borderRadius: '0 12px 0 12px',
                      background: scores[String(r.id)] > 0.8 ? '#52c41a' : scores[String(r.id)] > 0.6 ? '#faad14' : '#bfbfbf',
                    }}
                  >
                    {Math.round(scores[String(r.id)] * 100)}%
                  </Text>
                ) : null}
              </View>
              <View style={{ padding: '12px 16px 16px' }}>
                <View style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text className="tag tag-blue" style={{ maxWidth: 200, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {type === 'mold' ? (r.title || r.id) : (r.styleCode || r.id)}
                  </Text>
                  {r.status ? <Text className={`tag ${statusTag(r.status)}`}>{r.status}</Text> : null}
                </View>
                {type === 'semi' && r.shortName ? (
                  <Text style={{ fontSize: 26, fontWeight: 600, display: 'block', margin: '8px 0 4px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {r.shortName}
                  </Text>
                ) : null}
                {type === 'mold' ? (
                  <Text style={{ fontSize: 26, fontWeight: 600, display: 'block', margin: '8px 0 4px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {r.title}
                  </Text>
                ) : null}
                <Text className="muted" style={{ display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {r.publisherCompany || '—'}
                </Text>
                <View style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  {type === 'mold' ? (
                    <Text className="amount">¥{(Number(r.price) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</Text>
                  ) : r.targetPrice ? (
                    <Text className="amount">期望 ¥{r.targetPrice}</Text>
                  ) : (
                    <Text className="muted">价格面议</Text>
                  )}
                  {type === 'semi' ? <Text className="muted">{r.quoteCount || 0} 报价</Text> : null}
                </View>
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

export default MarketView
