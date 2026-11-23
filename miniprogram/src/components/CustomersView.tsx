import { useState, useEffect } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getListPage, ListItem } from '../services/api'

// 逐客底色调色板：与服务端 cardBg 同序同色；服务端未部署时按下标兜底上色
const CARD_BGS = ['#e6f4ff', '#f6ffed', '#fff7e6', '#fff1f0', '#f9f0ff', '#e6fffb']

/**
 * 客户列表：服务端 /wx/lists/customers 下发全量客户（直接客户+绑定采购商）与财务口径
 * （信用/剩余额度、采购总额/应收欠款，与 Web CustomerInfo 同源）；卡片逐客不同底色；
 * 账单明细/对账管理入口在底部子菜单条（不在客户卡内）。
 */
const CustomersView = ({ tick = 0 }: { tick?: number }) => {
  const [input, setInput] = useState('')
  const [applied, setApplied] = useState('')
  const [list, setList] = useState<ListItem[]>([])
  const [total, setTotal] = useState(0)
  // 应收欠款总额（服务端按当前筛选列表汇总下发）：计数行靠右展示，欠红/无欠绿与网页版同色
  const [debtTotal, setDebtTotal] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [detailItem, setDetailItem] = useState<ListItem | null>(null)

  useEffect(() => {
    setLoaded(false)
    getListPage('customers', applied)
      .then(d => { setList(d.list || []); setTotal(d.total || 0); setDebtTotal(typeof d.debtTotal === 'number' ? d.debtTotal : null) })
      .catch(e => Taro.showToast({ title: e.message, icon: 'none' }))
      .finally(() => setLoaded(true))
  }, [applied, tick])

  return (
    <View>
      {/* 搜索行：与 ListView 同口径（点击查询才生效的双态过滤）；全页方形（卡片/输入框/按键直角） */}
      <View style={{ display: 'flex', padding: '16px 24px 0', alignItems: 'center' }}>
        <Input
          style={{ flex: 1, marginBottom: 0, height: 36, lineHeight: '36px', fontSize: 17, padding: '0 11px', background: '#fff', border: '1px solid #c9d1da', borderRadius: 0, boxSizing: 'border-box' }}
          placeholderStyle="color:#9aa3ad;font-size:17px"
          placeholder="搜索关键字"
          value={input}
          onInput={e => setInput(e.detail.value)}
          onConfirm={() => setApplied(input.trim())}
        />
        <View
          style={{ marginLeft: 8, height: 36, lineHeight: '36px', padding: '0 16px', fontSize: 15, color: '#fff', background: '#1677ff', borderRadius: 0, flexShrink: 0, boxSizing: 'border-box' }}
          onClick={() => setApplied(input.trim())}
        >
          查询
        </View>
      </View>
      {loaded && total > 0 && (
        <View style={{ display: 'flex', alignItems: 'center', padding: '8px 24px 0' }}>
          <Text className="muted" style={{ fontSize: 15, flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>共 {total} 条，显示前 {list.length} 条</Text>
          {debtTotal !== null && (
            <Text style={{ flexShrink: 0, marginLeft: 8, fontSize: 15, fontWeight: 600, color: debtTotal > 0 ? '#ff4d4f' : '#52c41a' }}>
              应收欠款总额 ¥{debtTotal.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </Text>
          )}
        </View>
      )}
      {loaded && list.length === 0 && <View className="empty">暂无数据</View>}
      <View style={{ padding: '0 24px' }}>
        {list.map((it, idx) => (
          <View
            key={String(it.key)}
            style={{ background: it.cardBg || CARD_BGS[idx % CARD_BGS.length], borderRadius: 0, padding: '10px 14px', marginTop: 8 }}
            onClick={() => (it.fields || []).length && setDetailItem(it)}
          >
            <View style={{ display: 'flex', alignItems: 'center' }}>
              <Text style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 600, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{it.title}</Text>
              {it.tag ? (
                <Text style={{ flexShrink: 0, marginLeft: 8, fontSize: 12, color: '#1677ff', background: '#fff', border: '1px solid #91caff', borderRadius: 6, padding: '1px 8px' }}>{it.tag}</Text>
              ) : null}
            </View>
            {(it.sub || []).map((s, i) => (
              <Text key={i} style={{ display: 'block', fontSize: (it.subSizes || [])[i] || 13, color: '#1f2733', marginTop: 4 }}>{s}</Text>
            ))}
          </View>
        ))}
      </View>
      {/* 详情弹层：服务端 fields 逐行 label-value */}
      {detailItem && (
        <View>
          <View style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 }} onClick={() => setDetailItem(null)} />
          <View style={{ position: 'fixed', left: 0, right: 0, bottom: 0, background: '#fff', padding: '16px 20px 28px', zIndex: 1001, maxHeight: '70%', boxSizing: 'border-box', overflowY: 'scroll' }}>
            <View style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <Text style={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600 }}>{detailItem.title}</Text>
              <Text style={{ fontSize: 18, color: '#86909c' }} onClick={() => setDetailItem(null)}>×</Text>
            </View>
            {(detailItem.fields || []).map(([label, value]) => (
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

export default CustomersView
