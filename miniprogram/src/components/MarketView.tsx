import { useState, useEffect, useMemo } from 'react'
import { View, Text, Image, Input, ScrollView } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getMarket, getMarketDetail, MarketDetail } from '../services/api'
import { computeSubjectFeatures, subjectSimilarity } from '../services/imageSimilarity'
import { getUser } from '../services/session'
import { fullImageUrl } from '../utils/imageUrl'
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

const money = (v: any) => `¥${(Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`

/** 模具类型归一：线上旧接口直传 rent/sell，新接口下发中文，角标与详情统一走这里 */
const modeText = (v: any): string => (v === 'rent' ? '出租' : v === 'sell' ? '出售' : String(v || ''))

// 详情字段行：与 Web MarketPage 详情弹窗 / MoldMarketTab 详情同口径（服务端不下发脱敏占位，只下发可见内容）
const detailRows = (d: MarketDetail): [string, string][] => {
  if (d.type === 'mold') {
    return [
      ['模具编号', d.moldCode || '—'],
      ['模具名称', d.moldName || '—'],
      ['规格型号', d.spec || '—'],
      ['类型', d.mode || '—'],
      ['价格', d.price ? `${money(d.price)}${d.rent ? '/天' : ''}` : '—'],
      ['数量总计', d.totalQty ? String(d.totalQty) : '—'],
      ['发布时间', d.publishTime || '—'],
      ['备注', d.remark || '—'],
    ]
  }
  if (d.type === 'finished') {
    return [
      ['商品简称', d.shortName || '—'],
      ['款式编码', d.styleCode || '—'],
      ['单位', d.unit || '件'],
      ['鞋面材质', d.shoeUpper || '—'],
      ['鞋底材质', d.shoeSole || '—'],
      ['总库存', String(d.totalStock || 0)],
      ['供货价', `${money(d.targetPrice)} 起`],
      ['上架时间', d.publishTime || '—'],
      ['状态', d.status || '—'],
    ]
  }
  return [
    ['商品简称', d.shortName || '—'],
    ['款式编码', d.styleCode || '—'],
    ['商品编码', d.productCode || '—'],
    ['数量', `${d.quantity || 0} ${d.unit || '件'}`],
    ['期望单价', d.targetPrice ? money(d.targetPrice) : '—'],
    ['报价截止', d.deadline || '—'],
    ['工序类型', (d.processTypes || []).join('、') || '—'],
    ['保证金', d.deposit ? `${money(d.deposit)}（${d.depositStatus || '需缴纳'}）` : '—'],
    ['状态', d.status || '—'],
    ['发布时间', d.publishTime || '—'],
    ['备注', d.remark || '—'],
  ]
}

// 详情底部弹层（与仓库统计记录详情同写法：遮罩高于 TabBar，面板靠底可滚）
const SHEET_MASK = { position: 'fixed', left: 0, right: 0, top: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 300 } as const
const SHEET_PANEL = { position: 'absolute', left: 0, right: 0, bottom: 0, background: '#fff', borderRadius: '16px 16px 0 0', paddingTop: 14, paddingBottom: 'calc(14px + env(safe-area-inset-bottom))', maxHeight: '82vh', boxSizing: 'border-box' } as const
const SHEET_TITLE = { flex: 1, fontSize: 18, fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } as const
const ROW_LABEL = { fontSize: 15, color: '#8a94a6', flexShrink: 0, marginRight: 12 } as const
const ROW_VALUE = { flex: 1, fontSize: 17, textAlign: 'right', wordBreak: 'break-all' } as const
const CONTACT_BTN = { height: 44, lineHeight: '44px', textAlign: 'center', fontSize: 17, color: '#fff', background: '#1677ff', borderRadius: 8, boxSizing: 'border-box' } as const

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
  const [imgFail, setImgFail] = useState<Record<string, boolean>>({})
  const [loaded, setLoaded] = useState(false)
  const [detail, setDetail] = useState<MarketDetail | null>(null)

  useEffect(() => {
    if (fixedType) setType(fixedType)
  }, [fixedType])

  useEffect(() => {
    setLoaded(false)
    setImgFail({})
    getMarket(type, applied)
      // 服务端保留图片字段的历史形态（相对 /api/images/file、/uploads/images、带 host 的绝对地址、base64），
      // weapp 下相对地址会被当成本地包路径而静默不渲染（表现为卡片封面整块空白），
      // 必须在入口统一归一为可加载地址，与详情弹层、聊天图片同一口径
      .then(d => setList((d.list || []).map((r: any) => ({ ...r, image: fullImageUrl(String(r.image || '')) }))))
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

  // 点卡片任意位置开详情：先用卡片字段占位即时渲染，详情接口回来再覆盖
  const openDetail = async (r: any) => {
    const base: any = { ...(r || {}), type }
    if (type === 'mold') {
      // 列表口径已有 title/moldCode/spec/mode，补齐 moldName 与 /天 标记，未部署时也能看出一份模具详情
      base.mode = modeText(r?.mode)
      base.moldName = r?.moldName || r?.title || ''
      base.rent = base.mode === '出租'
    }
    // 自己（或本公司子账号）发布的记录不显示联系键；服务端 canContact 按 owner 判定，接口未部署时按账号+公司名本地兜底
    if (base.canContact === undefined) {
      const me = getUser()
      const pub = String(base.publisherUsername || '')
      const mine = !!me && (pub === me.username || (!!me.company_name && String(base.publisherCompany || '') === me.company_name))
      base.canContact = !!pub && !mine
    }
    setDetail(base as MarketDetail)
    try {
      const d = await getMarketDetail(type, String(r?.id || ''))
      if (d && d.detail) setDetail(d.detail)
      else Taro.showToast({ title: '详情接口尚未部署上线，暂显示列表信息', icon: 'none' })
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '详情加载失败', icon: 'none' })
    }
  }

  // 与网页版同行为：联系=直接打开与该发布方的站内会话
  const openContact = () => {
    const pub = String(detail?.publisherUsername || '')
    if (!pub) { Taro.showToast({ title: '未获取到供应商标账号', icon: 'none' }); return }
    const name = encodeURIComponent(String(detail?.publisherCompany || pub))
    const subject = encodeURIComponent(String(detail?.shortName || detail?.title || ''))
    Taro.navigateTo({ url: `/pages/chat/index?to=${encodeURIComponent(pub)}&name=${name}&subject=${subject}` })
  }

  const shown = refUrl && Object.keys(scores).length
    ? [...filtered].sort((a, b) => (scores[String(b.id)] || 0) - (scores[String(a.id)] || 0))
    : filtered
  // 搜索行尺寸：输入框与两个按键等高（weapp 下全局类尺寸会压过行内覆盖，故一律纯行内自带全部视觉属性）
  const cellH = 39
  const btnStyle = { marginLeft: 7, height: cellH, lineHeight: `${cellH}px`, padding: '0 11px', fontSize: 17, color: '#fff', background: '#1677ff', borderRadius: 7, textAlign: 'center', flexShrink: 0, boxSizing: 'border-box' } as const
  const inputStyle = { flex: 1, marginBottom: 0, height: cellH, lineHeight: `${cellH}px`, fontSize: 17, padding: '0 11px', background: '#fff', border: '1px solid #c9d1da', borderRadius: 7, boxSizing: 'border-box' } as const

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
            <View
              style={{ background: '#fff', borderRadius: 12, overflow: 'hidden', boxShadow: '0 2px 8px rgba(31,39,51,0.06)', position: 'relative' }}
              onClick={() => openDetail(r)}
            >
              {/* 封面区：padding-top:100% 撑出正方形（H5/weapp 通用，不依赖 aspect-ratio） */}
              <View style={{ position: 'relative', width: '100%', paddingTop: '100%' }}>
                {r.image && !imgFail[String(r.id)] ? (
                  <Image
                    src={r.image} mode="aspectFill"
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                    onError={() => setImgFail(v => ({ ...v, [String(r.id)]: true }))}
                  />
                ) : (
                  <View style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'linear-gradient(135deg,#e6f4ff,#f0f5ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 72 }}>
                    {type === 'mold' ? '🧰' : '🛍️'}
                  </View>
                )}
                {type === 'mold' && modeText(r.mode) ? (
                  <Text style={{ position: 'absolute', top: 0, left: 0, color: '#fff', fontSize: 20, lineHeight: '32px', padding: '0 14px', borderRadius: '12px 0 12px 0', background: modeText(r.mode) === '出租' ? 'linear-gradient(135deg,#1677ff,#69b1ff)' : 'linear-gradient(135deg,#52c41a,#95de64)' }}>
                    {modeText(r.mode)}
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
                {/* 第二行显示规格而不是重复一遍标题；字号取原 26 的 30%（行内数字按真实 px 渲染，26≈52rpx → 8≈16rpx） */}
                {type === 'mold' ? (
                  <Text style={{ fontSize: 8, lineHeight: '12px', fontWeight: 400, display: 'block', margin: '4px 0 2px', color: '#5a6d85', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    规格：{r.spec || '—'}
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
      {/* 产品详情底部弹层：字段与 Web 详情弹窗同口径，底部「联系」直接发起站内会话 */}
      {detail && (() => {
        const rawImgs = Array.isArray(detail.images) && detail.images.length
          ? detail.images
          : ((detail as any).image ? [(detail as any).image] : [])
        const imgs = rawImgs.map((u: string) => fullImageUrl(u)).filter(Boolean)
        const skus = detail.variants || []
        const qs = detail.quotes || []
        const specs = detail.specs || []
        return (
          <View style={SHEET_MASK} onClick={() => setDetail(null)}>
            <View style={SHEET_PANEL} onClick={e => e.stopPropagation()}>
              <View style={{ display: 'flex', alignItems: 'center', padding: '0 20px 12px', borderBottom: '1px solid #f0f2f5' }}>
                <Text style={SHEET_TITLE}>
                  {detail.type === 'mold' ? '模具详情'
                    : detail.type === 'finished' ? `成品详情 - ${detail.id || ''}` : `发包详情 - ${detail.id || ''}`}
                </Text>
                <Text style={{ fontSize: 15, color: '#8a94a6', paddingLeft: 12 }} onClick={() => setDetail(null)}>关闭</Text>
              </View>
              <ScrollView scrollY style={{ maxHeight: '58vh', padding: '12px 20px 0' }}>
                {imgs.length ? (
                  <View>
                    <View style={{ position: 'relative', width: '100%', paddingTop: '72%', borderRadius: 10, overflow: 'hidden', background: '#f5f6f8' }}>
                      <Image
                        src={imgs[0]} mode="aspectFill"
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                        onClick={() => Taro.previewImage({ urls: imgs, current: imgs[0] })}
                      />
                    </View>
                    {imgs.length > 1 && (
                      <View style={{ display: 'flex', flexWrap: 'wrap', marginTop: 8 }}>
                        {imgs.slice(1).map((u, i) => (
                          <Image
                            key={i} src={u} mode="aspectFill"
                            style={{ width: 52, height: 52, borderRadius: 6, margin: '0 8px 8px 0', background: '#f5f6f8' }}
                            onClick={() => Taro.previewImage({ urls: imgs, current: u })}
                          />
                        ))}
                      </View>
                    )}
                  </View>
                ) : null}
                {detailRows(detail).map(([label, value]) => (
                  <View key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid #f7f8fa' }}>
                    <Text style={ROW_LABEL}>{label}</Text>
                    <Text style={ROW_VALUE}>{value}</Text>
                  </View>
                ))}
                <View style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '7px 0' }}>
                  <Text style={ROW_LABEL}>供应商</Text>
                  <Text style={ROW_VALUE}>{detail.publisherCompany || '—'}</Text>
                </View>
                {specs.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    <Text style={{ fontSize: 15, color: '#8a94a6' }}>规格明细与数量</Text>
                    {specs.map((s, i) => (
                      <View key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 15 }}>
                        <Text style={{ flex: 1 }}>{s.spec}</Text>
                        <Text style={{ color: '#1677ff' }}>× {s.qty}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {skus.length > 0 && (
                  <View style={{ marginTop: 10, border: '1px solid #e6e9ee', borderRadius: 8, overflow: 'hidden' }}>
                    <View style={{ display: 'flex', background: '#fafbfc', padding: '6px 10px', fontSize: 13, color: '#8a94a6' }}>
                      <Text style={{ flex: 2 }}>颜色/SKU</Text>
                      <Text style={{ flex: 1.4 }}>规格</Text>
                      <Text style={{ flex: 1, textAlign: 'right' }}>供货价</Text>
                      <Text style={{ flex: 1, textAlign: 'right' }}>库存</Text>
                    </View>
                    {skus.map((v, i) => (
                      <View key={i} style={{ display: 'flex', padding: '6px 10px', fontSize: 15, borderTop: '1px solid #f0f2f5' }}>
                        <View style={{ flex: 2 }}>
                          <Text style={{ fontSize: 15 }}>{v.color || '—'}</Text>
                          <Text style={{ display: 'block', fontSize: 13, color: '#8a94a6' }}>{v.productCode || ''}</Text>
                        </View>
                        <Text style={{ flex: 1.4 }}>{v.spec || '—'}</Text>
                        <Text style={{ flex: 1, textAlign: 'right', color: '#f5222d' }}>{money(v.unitPrice)}</Text>
                        <Text style={{ flex: 1, textAlign: 'right' }}>{v.stock || 0}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {qs.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <Text style={{ fontSize: 15, color: '#8a94a6' }}>报价记录（{qs.length}）</Text>
                    {qs.map((q, i) => (
                      <View key={i} style={{ marginTop: 6, padding: '8px 10px', background: '#fafbfc', borderRadius: 8 }}>
                        <Text style={{ fontSize: 15 }}>{q.company || '—'}</Text>
                        <Text style={{ display: 'block', fontSize: 14, color: '#8a94a6' }}>
                          单价 {money(q.unitPrice)} · 总价 {money(q.totalPrice)} · 交期 {q.deliveryDays || '—'} 天 · {q.status || '—'}
                        </Text>
                        {(q.contactPerson || q.contactPhone) ? (
                          <Text style={{ display: 'block', fontSize: 14, color: '#8a94a6' }}>{[q.contactPerson, q.contactPhone].filter(Boolean).join(' · ')}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
              {detail.canContact ? (
                <View style={{ padding: '12px 20px 0' }}>
                  <View style={CONTACT_BTN} onClick={openContact}>联系</View>
                </View>
              ) : null}
            </View>
          </View>
        )
      })()}
    </View>
  )
}

export default MarketView
