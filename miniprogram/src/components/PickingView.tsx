import { useState, useEffect } from 'react'
import { View, Text, Input, ScrollView, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getPicking, shipPicking, PickingItem } from '../services/api'
import { chooseAndUploadImages } from '../services/upload'
import scanCameraIcon from '../assets/scan-camera.png'

const fmtMoney = (v: any): string => (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100

// —— 行内样式常量（weapp 中类选择器会压过行内样式，精细控件统一纯行内）——
const SEARCH_BAR = { display: 'flex', alignItems: 'center', padding: '16px 24px 0' } as const
const SEARCH_INPUT = { flex: 1, height: 36, background: '#ffffff', border: '1px solid #c9d4e3', borderRadius: 0, padding: '0 12px', fontSize: 15, boxSizing: 'border-box' } as const
const SEARCH_BTN = { marginLeft: 8, height: 36, lineHeight: '36px', padding: '0 16px', background: '#1677ff', color: '#ffffff', fontSize: 15, borderRadius: 0, textAlign: 'center', flexShrink: 0 } as const
const COUNT_LINE = { padding: '8px 24px 0', fontSize: 12, color: '#86909c' } as const
const CARD = { background: '#ffffff', borderRadius: 0, margin: '12px 24px 0', padding: '12px 16px', boxShadow: '0 1px 4px rgba(31,39,51,0.04)' } as const
// 三行字号统一与「订单编号」一致（.card 未设 font-size，正文基准 28px 走 rpx 通道）
const CARD_ROW1 = { display: 'flex', alignItems: 'center' } as const
const CARD_ID = { flex: 1.1, minWidth: 0, fontSize: '28rpx', fontWeight: 600, color: '#1f2733' } as const
const CARD_OUT = { flex: 1, minWidth: 0, fontSize: '28rpx', color: '#5a6d85', textAlign: 'center' } as const
const CARD_LINE = { marginTop: 6, fontSize: '28rpx', color: '#1f2733' } as const
const CARD_SUB = { marginTop: 6, fontSize: '28rpx', color: '#5a6d85' } as const
// 打印状态角标（恢复旧列表右侧标签）：已打印绿 / 已拣货蓝 / 其余橙
const CARD_TAG = { flexShrink: 0, marginLeft: 8, padding: '2px 10px', borderRadius: 10, fontSize: '22rpx', lineHeight: '32rpx', color: '#ffffff' } as const
const printToneOf = (s: string): string => (s === '已打印' ? '#52c41a' : s === '已拣货' ? '#1677ff' : '#faad14')

const MASK = { position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 } as const
const SHEET = { position: 'fixed', left: 0, right: 0, bottom: 0, background: '#f7f9fb', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '0 20px 28px', zIndex: 1001, maxHeight: '82%', boxSizing: 'border-box' } as const
const SHEET_HEAD = { display: 'flex', alignItems: 'center', paddingTop: 16 } as const
const SHEET_TITLE = { flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, color: '#1f2733', overflow: 'hidden' } as const
const CLOSE_X = { flexShrink: 0, marginLeft: 12, fontSize: 20, color: '#86909c', lineHeight: '22px' } as const
const INFO_BLOCK = { marginTop: 12, background: '#ffffff', borderRadius: 10, padding: '4px 12px', overflow: 'hidden' } as const
const INFO_ROW = { display: 'flex', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #f2f4f7' } as const
const INFO_LBL = { flexShrink: 0, width: 72, fontSize: 13, color: '#86909c', lineHeight: '19px' } as const
const INFO_VAL = { flex: 1, minWidth: 0, fontSize: 13, color: '#1f2733', lineHeight: '19px', wordBreak: 'break-all' } as const
const SEC_TITLE = { margin: '14px 0 8px' } as const
const SEC_TXT = { fontSize: 14, fontWeight: 600, color: '#1f2733' } as const
const TABLE_BOX = { background: '#ffffff', borderRadius: 10, overflow: 'hidden' } as const
const T_HEAD = { display: 'flex', alignItems: 'center', background: '#f2f5f9', padding: '7px 10px' } as const
const T_ROW = { display: 'flex', alignItems: 'center', padding: '7px 10px', borderBottom: '1px solid #f2f4f7' } as const
const TH = { fontSize: 12, fontWeight: 600, color: '#5a6d85' } as const
const TD = { fontSize: 12, color: '#1f2733', overflow: 'hidden' } as const
const EMPTY_ITEMS = { padding: '18px 0', textAlign: 'center', fontSize: 13, color: '#86909c' } as const
const SHIP_BTN = { marginTop: 16, height: 44, lineHeight: '44px', textAlign: 'center', fontSize: 16, fontWeight: 600, color: '#ffffff', background: '#1677ff', borderRadius: 8 } as const
const BACK_BTN = { marginTop: 10, height: 40, lineHeight: '40px', textAlign: 'center', fontSize: 14, color: '#5a6d85', background: '#eef1f5', borderRadius: 8 } as const
const QTY_INPUT = { width: 74, height: 30, lineHeight: '30px', textAlign: 'right', fontSize: 13, border: '1px solid #c9d4e3', borderRadius: 6, padding: '0 6px', boxSizing: 'border-box', background: '#fff' } as const
const HINT = { marginTop: 8, fontSize: 12, color: '#fa8c16', lineHeight: '18px' } as const
const IMG_ADD_BTN = { flexShrink: 0, fontSize: 13, color: '#1677ff' } as const
const IMG_GRID = { display: 'flex', flexWrap: 'wrap' } as const
const IMG_THUMB_WRAP = { position: 'relative', width: 72, height: 72, marginRight: 8, marginBottom: 8 } as const
const IMG_THUMB = { width: 72, height: 72, borderRadius: 6, background: '#eef2f6' } as const
const IMG_DEL = { position: 'absolute', top: -6, right: -6, width: 20, height: 20, lineHeight: '20px', textAlign: 'center', fontSize: 13, color: '#ffffff', background: 'rgba(0,0,0,0.55)', borderRadius: 10 } as const

/**
 * 打单拣货视图（订单派生视图 + 立即发货）：
 * 卡片三行——① 左订单编号 / 右出库单号；② 款式编码×汇总数量；③ 收款人 + 收款人城市，三行字号与订单编号一致。
 * 点卡片看订单详情，详情内「立即发货」进入货品明细：商品编码 + 数量（可改，只能 ≤ 订单数量），
 * 发货数量少于订单数量时服务端对缺少部分即时缺货拆分（子单号 = 原单号-1、出库单号 = 原出库单号-1）。
 */
const PickingView = ({ tick = 0 }: { tick?: number }) => {
  const [q, setQ] = useState('')
  const [keyword, setKeyword] = useState('')
  const [list, setList] = useState<PickingItem[]>([])
  const [total, setTotal] = useState(0)
  const [loaded, setLoaded] = useState(false)
  // 新服务端接口未部署时返回 404：在正文渲染提示而非仅弹 toast（避免“暂无数据”与“接口未就绪”混淆）
  const [errMsg, setErrMsg] = useState('')
  const [detail, setDetail] = useState<PickingItem | null>(null)
  // shipMode=false 显示订单详情；true 显示可改数量的货品明细
  const [shipMode, setShipMode] = useState(false)
  const [shipQtys, setShipQtys] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  // 发货凭证图片（URL 数组，选图后逐张压缩上传）
  const [shipImages, setShipImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)

  const load = () => {
    setLoaded(false)
    getPicking(keyword)
      .then(d => { setList(d.list || []); setTotal(d.total || 0); setErrMsg('') })
      .catch(e => { setErrMsg(e?.message || '打单拣货数据暂不可用（服务端接口尚未部署）'); setList([]); setTotal(0) })
      .finally(() => setLoaded(true))
  }
  useEffect(load, [keyword, tick])

  const doSearch = () => setKeyword(q.trim())

  // 扫码搜索：扫二维码/条形码，结果回填搜索框并立即查询（码值通常为订单号/出库单号）
  const scanSearch = () => {
    Taro.scanCode({ scanType: ['qrCode', 'barCode'] })
      .then(res => {
        const code = String(res.result || '').trim()
        if (!code) { Taro.showToast({ title: '扫码结果为空', icon: 'none' }); return }
        setQ(code)
        setKeyword(code)
      })
      .catch(() => Taro.showToast({ title: '已取消扫码', icon: 'none' }))
  }

  const openDetail = (r: PickingItem) => {
    setDetail(r)
    setShipMode(false)
    setShipQtys((r.items || []).map(it => Number(it.quantity) || 0))
    setShipImages([])
  }
  const closeDetail = () => { setDetail(null); setShipMode(false); setSaving(false); setShipImages([]) }

  // 进入发货：以订单数量初始化可改数量
  const enterShip = () => {
    if (!detail) return
    setShipQtys((detail.items || []).map(it => Number(it.quantity) || 0))
    setShipMode(true)
  }

  // 选图（拍照/相册）→ 逐张压缩上传 → 追加；上限 9 张
  const addShipImages = async () => {
    if (uploading) return
    if (shipImages.length >= 9) { Taro.showToast({ title: '最多 9 张图片', icon: 'none' }); return }
    setUploading(true)
    try {
      const urls = await chooseAndUploadImages(9 - shipImages.length)
      if (urls.length) setShipImages(prev => [...prev, ...urls].slice(0, 9))
    } catch (e: any) {
      if (e?.message) Taro.showToast({ title: e.message, icon: 'none' })
    } finally { setUploading(false) }
  }
  const removeShipImage = (i: number) => setShipImages(prev => prev.filter((_, idx) => idx !== i))

  // 修改数量：钳制 0..订单数量（不能大于订单数量）
  const setQty = (i: number, max: number, val: string) => {
    let n = parseInt(val, 10)
    if (!Number.isFinite(n) || n < 0) n = 0
    if (n > max) { n = max; Taro.showToast({ title: `发货数量不能大于订单数量 ${max}`, icon: 'none' }) }
    setShipQtys(prev => prev.map((x, idx) => (idx === i ? n : x)))
  }

  const shipTotal = shipQtys.reduce((s, n) => s + (Number(n) || 0), 0)
  const orderTotal = (detail?.items || []).reduce((s, it) => s + (Number(it.quantity) || 0), 0)
  const willSplit = shipQtys.some((n, i) => round2((Number((detail?.items || [])[i]?.quantity) || 0) - (Number(n) || 0)) > 0)

  const confirmShip = () => {
    if (!detail || saving) return
    if (!(shipTotal > 0)) { Taro.showToast({ title: '发货数量需大于 0', icon: 'none' }); return }
    const tip = willSplit
      ? `本次发货 ${shipTotal} 件，缺少 ${round2(orderTotal - shipTotal)} 件将即时拆分为生产订单（新单号 ${detail.id}-1）。确定发货？`
      : `确定将订单 ${detail.id} 全部 ${shipTotal} 件立即发货？将生成销售出库单并扣减库存。`
    Taro.showModal({
      title: '立即发货', content: tip, confirmText: '确定发货', cancelText: '取消',
      success: m => {
        if (!m.confirm) return
        setSaving(true)
        shipPicking(detail.id, shipQtys, shipImages)
          .then(r => {
            Taro.showToast({ title: r.needSplit ? `已发货并拆出子单 ${r.splitChildId}` : '发货成功', icon: 'none' })
            closeDetail()
            load()
          })
          .catch(e => Taro.showToast({ title: e?.message || '发货失败', icon: 'none' }))
          .finally(() => setSaving(false))
      },
    })
  }

  const detailItems = detail?.items || []

  return (
    <View>
      <View style={{ ...SEARCH_BAR }}>
        <Input
          style={{ ...SEARCH_INPUT }}
          placeholder="搜索订单号 / 出库单号 / 款式 / 收款人"
          placeholderStyle="color:#b0bcca"
          value={q}
          onInput={e => setQ(e.detail.value)}
          onConfirm={doSearch}
          confirmType="search"
        />
        <View style={{ ...SEARCH_BTN }} onClick={doSearch}>查询</View>
        {/* 扫码搜索键：蓝色取景框相机图（扫码语义），方形描边与本页风格一致 */}
        <View
          style={{ marginLeft: 8, width: 36, height: 36, flexShrink: 0, borderRadius: 0, background: '#fff', border: '1px solid #c9d4e3', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={scanSearch}
        >
          <Image src={scanCameraIcon} style={{ width: 24, height: 24, display: 'block' }} mode="aspectFit" />
        </View>
      </View>
      {loaded && !errMsg && <View style={{ ...COUNT_LINE }}>共 {total} 条，显示前 {list.length} 条</View>}
      {loaded && errMsg ? <View className="empty">{errMsg}</View> : null}
      {loaded && !errMsg && list.length === 0 && <View className="empty">暂无待打单拣货订单</View>}
      {list.map((r: PickingItem) => (
        <View key={r.key} style={{ ...CARD }} onClick={() => openDetail(r)}>
          {/* 第一行：左订单编号 / 右出库单号 */}
          <View style={{ ...CARD_ROW1 }}>
            <Text style={{ ...CARD_ID }} numberOfLines={1}>{r.id || '—'}</Text>
            <Text style={{ ...CARD_OUT }} numberOfLines={1}>{r.outboundNo || '—'}</Text>
            {r.printStatus ? <Text style={{ ...CARD_TAG, background: printToneOf(r.printStatus) }}>{r.printStatus}</Text> : null}
          </View>
          {/* 第二行：款式编码×汇总数量 */}
          <Text style={{ ...CARD_LINE, display: 'block' }} numberOfLines={1}>{r.styleQty || '—'}</Text>
          {/* 第三行：收款人 + 收款人城市 */}
          <Text style={{ ...CARD_SUB, display: 'block' }} numberOfLines={1}>
            收款人 {r.receiverName || '—'}{r.receiverCity ? `　${r.receiverCity}` : ''}
          </Text>
        </View>
      ))}

      {detail && (
        <View>
          <View style={{ ...MASK }} onClick={closeDetail} />
          <View style={{ ...SHEET }}>
            <View style={{ ...SHEET_HEAD }}>
              <Text style={{ ...SHEET_TITLE }} numberOfLines={1}>{shipMode ? '立即发货 - 货品明细' : `订单详情 - ${detail.id}`}</Text>
              <Text style={{ ...CLOSE_X }} onClick={closeDetail}>×</Text>
            </View>

            {!shipMode ? (
              <ScrollView scrollY style={{ maxHeight: '62vh' }}>
                <View style={{ ...INFO_BLOCK }}>
                  <View style={{ ...INFO_ROW }}>
                    <Text style={{ ...INFO_LBL }}>订单编号</Text>
                    <Text style={{ ...INFO_VAL }}>{detail.id || '—'}</Text>
                  </View>
                  <View style={{ ...INFO_ROW }}>
                    <Text style={{ ...INFO_LBL }}>出库单号</Text>
                    <Text style={{ ...INFO_VAL }}>{detail.outboundNo || '—'}</Text>
                  </View>
                  <View style={{ ...INFO_ROW }}>
                    <Text style={{ ...INFO_LBL }}>客户</Text>
                    <Text style={{ ...INFO_VAL }}>{detail.customerName || '—'}</Text>
                  </View>
                  <View style={{ ...INFO_ROW }}>
                    <Text style={{ ...INFO_LBL }}>收款人</Text>
                    <Text style={{ ...INFO_VAL }}>{detail.receiverName || '—'}{detail.receiverCity ? `　${detail.receiverCity}` : ''}</Text>
                  </View>
                  <View style={{ ...INFO_ROW }}>
                    <Text style={{ ...INFO_LBL }}>联系电话</Text>
                    <Text style={{ ...INFO_VAL }}>{detail.receiverPhone || '—'}</Text>
                  </View>
                  <View style={{ ...INFO_ROW }}>
                    <Text style={{ ...INFO_LBL }}>详细地址</Text>
                    <Text style={{ ...INFO_VAL }}>{detail.receiverAddress || '—'}</Text>
                  </View>
                  <View style={{ ...INFO_ROW }}>
                    <Text style={{ ...INFO_LBL }}>款式数量</Text>
                    <Text style={{ ...INFO_VAL }}>{detail.styleQty || '—'}</Text>
                  </View>
                  <View style={{ ...INFO_ROW, borderBottom: 'none' }}>
                    <Text style={{ ...INFO_LBL }}>商品总额</Text>
                    <Text style={{ ...INFO_VAL, color: '#e5533c', fontWeight: 600 }}>¥{fmtMoney(detail.productAmount)}　共 {detail.totalQty || 0} 件</Text>
                  </View>
                </View>

                {/* 发货凭证图片：发货时上传存档，详情只读展示、点击预览 */}
                {(detail.shipImages || []).length ? (
                  <View>
                    <View style={{ ...SEC_TITLE }}><Text style={{ ...SEC_TXT }}>发货凭证图片（{detail.shipImages.length}）</Text></View>
                    <View style={{ ...IMG_GRID }}>
                      {detail.shipImages.map((u, i) => (
                        <Image key={i} src={u} mode="aspectFill" style={{ ...IMG_THUMB, marginRight: 8, marginBottom: 8 }} onClick={() => Taro.previewImage({ urls: detail.shipImages, current: u })} />
                      ))}
                    </View>
                  </View>
                ) : null}

                <View style={{ ...SEC_TITLE }}><Text style={{ ...SEC_TXT }}>货品明细（{detailItems.length}）</Text></View>
                {detailItems.length === 0 ? (
                  <View style={{ ...TABLE_BOX }}><View style={{ ...EMPTY_ITEMS }}>暂无货品明细</View></View>
                ) : (
                  <View style={{ ...TABLE_BOX }}>
                    <View style={{ ...T_HEAD }}>
                      <Text style={{ ...TH, flex: 1, minWidth: 0 }}>商品编码</Text>
                      <Text style={{ ...TH, width: 60, textAlign: 'right' }}>数量</Text>
                    </View>
                    {detailItems.map((it, idx) => (
                      <View key={idx} style={{ ...T_ROW }}>
                        <Text style={{ ...TD, flex: 1, minWidth: 0 }} numberOfLines={1}>{it.productCode || '—'}{it.color ? ` / ${it.color}` : ''}{it.spec ? ` / ${it.spec}` : ''}</Text>
                        <Text style={{ ...TD, width: 60, textAlign: 'right' }}>{it.quantity}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {detail.legacy ? (
                  <View style={{ ...HINT }}>该记录为无关联订单的遗留拣货单，仅可查看，不支持发货。</View>
                ) : (
                  <View style={{ ...SHIP_BTN }} onClick={enterShip}>立即发货</View>
                )}
              </ScrollView>
            ) : (
              <ScrollView scrollY style={{ maxHeight: '62vh' }}>
                <View style={{ ...SEC_TITLE }}><Text style={{ ...SEC_TXT }}>货品明细（可修改发货数量）</Text></View>
                <View style={{ ...TABLE_BOX }}>
                  <View style={{ ...T_HEAD }}>
                    <Text style={{ ...TH, flex: 1, minWidth: 0 }}>商品编码</Text>
                    <Text style={{ ...TH, width: 60, textAlign: 'center' }}>订单数量</Text>
                    <Text style={{ ...TH, width: 80, textAlign: 'right' }}>发货数量</Text>
                  </View>
                  {detailItems.map((it, idx) => (
                    <View key={idx} style={{ ...T_ROW }}>
                      <Text style={{ ...TD, flex: 1, minWidth: 0 }} numberOfLines={1}>{it.productCode || '—'}{it.color ? ` / ${it.color}` : ''}{it.spec ? ` / ${it.spec}` : ''}</Text>
                      <Text style={{ ...TD, width: 60, textAlign: 'center' }}>{it.quantity}</Text>
                      <View style={{ width: 80, display: 'flex', justifyContent: 'flex-end' }}>
                        <Input
                          style={{ ...QTY_INPUT }}
                          type="number"
                          value={String(shipQtys[idx] ?? 0)}
                          onInput={e => { setQty(idx, Number(it.quantity) || 0, e.detail.value); return e.detail.value }}
                        />
                      </View>
                    </View>
                  ))}
                </View>
                {/* 发货凭证图片：拍照/相册多选，逐张压缩后上传，可预览/单张删除 */}
                <View style={{ ...SEC_TITLE, marginTop: 14 }}>
                  <Text style={{ ...SEC_TXT }}>发货凭证图片（{shipImages.length}/9）</Text>
                  <Text style={{ ...IMG_ADD_BTN }} onClick={addShipImages}>{uploading ? '上传中…' : '+ 拍照/相册'}</Text>
                </View>
                {shipImages.length ? (
                  <View style={{ ...IMG_GRID }}>
                    {shipImages.map((u, i) => (
                      <View key={i} style={{ ...IMG_THUMB_WRAP }}>
                        <Image src={u} mode="aspectFill" style={{ ...IMG_THUMB }} onClick={() => Taro.previewImage({ urls: shipImages, current: u })} />
                        <Text style={{ ...IMG_DEL }} onClick={() => removeShipImage(i)}>×</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={{ ...HINT, color: '#86909c' }}>可选：上传发货凭证图片（自动压缩），随发货一并存档。</View>
                )}
                <View style={{ ...INFO_BLOCK, marginTop: 12 }}>
                  <View style={{ ...INFO_ROW, borderBottom: 'none' }}>
                    <Text style={{ ...INFO_LBL }}>发货合计</Text>
                    <Text style={{ ...INFO_VAL, fontWeight: 600 }}>{shipTotal} / {orderTotal} 件</Text>
                  </View>
                </View>
                {willSplit ? (
                  <View style={{ ...HINT }}>
                    发货数量少于订单数量，缺少的 {round2(orderTotal - shipTotal)} 件将在发货后即时拆分为生产订单，
                    新订单号 {detail.id}-1、新出库单号 {(detail.outboundNo || detail.id)}-1。
                  </View>
                ) : (
                  <View style={{ ...HINT, color: '#86909c' }}>发货数量等于订单数量，将整单发货，不产生拆分。</View>
                )}
                <View style={{ ...SHIP_BTN, background: saving ? '#9bbdf5' : '#1677ff' }} onClick={confirmShip}>{saving ? '发货中…' : '确认发货'}</View>
                <View style={{ ...BACK_BTN }} onClick={() => setShipMode(false)}>返回详情</View>
              </ScrollView>
            )}
          </View>
        </View>
      )}
    </View>
  )
}

export default PickingView
