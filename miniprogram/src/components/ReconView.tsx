import { useState, useEffect } from 'react'
import { View, Text } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getReconRecords, confirmRecon, ReconRecordBrief } from '../services/api'

const money = (v: number) => `¥${(Math.round((Number(v) || 0) * 100) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * 对账管理：数据源为服务端 recon_db_supplier_<owner> 存活对账记录（与 Web ReconciliationManage 供应商平台同库），
 * 不再复用账单明细行；每卡提供「确认对账」，走 POST /wx/recon/:key/confirm 与 Web completeRecon('confirmSupplier')
 * 同口径落库（供方明细「对账完成」+ 采方账单「已对账」+ 双方对账库完成墓碑）。
 */
const ReconView = ({ tick = 0 }: { tick?: number }) => {
  const [list, setList] = useState<ReconRecordBrief[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [busyKey, setBusyKey] = useState('')
  const [detailItem, setDetailItem] = useState<ReconRecordBrief | null>(null)

  const load = () => {
    setLoaded(false)
    getReconRecords()
      .then(d => { setList(d.list || []); setFailed(false) })
      .catch(() => setFailed(true))
      .finally(() => setLoaded(true))
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const confirm = (r: ReconRecordBrief) => {
    if (busyKey) return
    Taro.showModal({
      title: '确认对账',
      content: `单据 ${r.docNo || r.key} 确认后将回写双方账单为已对账并完成本笔对账记录，是否继续？`,
      success: res => {
        if (!res.confirm) return
        setBusyKey(r.key)
        confirmRecon(r.key)
          .then(() => { Taro.showToast({ title: '对账完成', icon: 'success' }); load() })
          .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
          .finally(() => setBusyKey(''))
      },
    })
  }

  const detailFields = (r: ReconRecordBrief): [string, string][] => [
    ['单据编号', r.docNo || '—'], ['客户', r.customerName || '—'], ['供应商', r.supplierName || '—'],
    ['供方金额', money(r.ourAmount)], ['采方金额', money(r.theirAmount)],
    ['发起方', r.initiator === 'supplier' ? '供应商' : (r.initiator === 'purchaser' ? '采购商' : (r.initiator || '—'))],
    ['发起时间', r.createdAt || '—'], ['对账状态', r.reconResult || '待对账'],
  ]

  return (
    <View>
      {loaded && !failed && (
        <View style={{ padding: '8px 24px 0' }}>
          <Text className="muted" style={{ fontSize: 15 }}>共 {list.length} 条待对账记录</Text>
        </View>
      )}
      {loaded && failed && <View className="empty">对账数据暂不可用（服务端部署后即可用）</View>}
      {loaded && !failed && list.length === 0 && <View className="empty">暂无待对账记录</View>}
      <View style={{ padding: '0 24px' }}>
        {list.map(r => (
          <View
            key={r.key}
            style={{ background: '#fff', borderRadius: 0, padding: '10px 14px', marginTop: 8 }}
            onClick={() => setDetailItem(r)}
          >
            <View style={{ display: 'flex', alignItems: 'center' }}>
              <Text style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{r.docNo || r.key}</Text>
              <Text style={{ flexShrink: 0, marginLeft: 8, fontSize: 12, color: r.initiator === 'supplier' ? '#1677ff' : '#fa8c16', background: r.initiator === 'supplier' ? '#e6f4ff' : '#fff7e6', border: `1px solid ${r.initiator === 'supplier' ? '#91caff' : '#ffd591'}`, borderRadius: 6, padding: '1px 8px' }}>
                {r.initiator === 'supplier' ? '供方发起' : '采方发起'}
              </Text>
            </View>
            <Text style={{ display: 'block', fontSize: 13, color: '#1f2733', marginTop: 4 }}>对方：{r.customerName || r.supplierName || '—'}</Text>
            <Text style={{ display: 'block', fontSize: 13, color: '#1f2733', marginTop: 2 }}>供方 {money(r.ourAmount)}　采方 {money(r.theirAmount)}</Text>
            {r.createdAt ? <Text style={{ display: 'block', fontSize: 12, color: '#5a6d85', marginTop: 2 }}>{r.createdAt}</Text> : null}
            <View
              style={{ marginTop: 8, height: 32, lineHeight: '32px', textAlign: 'center', fontSize: 13, color: '#fff', background: busyKey === r.key ? '#9ec9ff' : '#1677ff', borderRadius: 0 }}
              onClick={(e: any) => { e.stopPropagation(); confirm(r) }}
            >
              {busyKey === r.key ? '提交中…' : '确认对账'}
            </View>
          </View>
        ))}
      </View>
      {/* 详情弹层 */}
      {detailItem && (
        <View>
          <View style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 }} onClick={() => setDetailItem(null)} />
          <View style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff', padding: '16px 20px 28px', zIndex: 1001, maxHeight: '70%', boxSizing: 'border-box', overflowY: 'scroll' }}>
            <View style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600 }}>{detailItem.docNo || detailItem.key}</Text>
              <Text style={{ fontSize: 18, color: '#86909c' }} onClick={() => setDetailItem(null)}>×</Text>
            </View>
            {detailFields(detailItem).map(([label, value]) => (
              <View key={label} style={{ display: 'flex', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #f2f4f7' }}>
                <Text style={{ flexShrink: 0, width: 80, fontSize: 13, color: '#86909c' }}>{label}</Text>
                <Text style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#1f2733', wordBreak: 'break-all' }}>{value}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  )
}

export default ReconView
