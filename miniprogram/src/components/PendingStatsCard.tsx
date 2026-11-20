import { useState, type ReactNode } from 'react'
import { View, Text, ScrollView } from '@tarojs/components'
import { PendingStats, PendingRowBrief } from '../services/api'

/**
 * 待生产数据统计（首页底部模块）
 * 指标、配色、文案与网页版 PendingProductionStatsPage + utils/productionStats 逐条对齐：
 * 数值由服务端 /wx/dashboard 用同一套公式计算后下发，手机端只做展示，避免出现两个数。
 */
const PRIMARY = '#1e4a7e'
const fmt = (v: number | null | undefined) => (Number(v) || 0).toLocaleString('zh-CN')

/** 状态标签配色（网页版 STATUS_COLOR 的 antd 色系映射） */
const STATUS_COLOR: Record<string, string> = {
  待排产: '#fa8c16', 生产中: '#1677ff', 已完成: '#52c41a', 异常: '#ff4d4f', 已取消: '#8c9bb0', 已拆分: '#722ed1',
}

const TABS = [
  { key: 'pool', label: '待生产池' },
  { key: 'bom', label: '齐套与阻塞' },
  { key: 'risk', label: '超期与节点' },
  { key: 'capacity', label: '产能与负荷' },
  { key: 'struct', label: '结构与效率' },
]

/** 指标卡：与网页版 MetricCard 同结构（label / value / sub）同配色入参；
    宽度按 375pt 屏宽两列估算（每卡约 154pt、正文有约 130pt），value 统一 nowrap + 短写避免撑破 */
const Metric = ({ label, value, sub, color = PRIMARY, bg = '#f0f5ff' }: {
  label: string; value: ReactNode; sub?: string; color?: string; bg?: string
}) => (
  <View style={{
    width: '48.5%', boxSizing: 'border-box', borderRadius: 10, padding: '10px 12px',
    background: bg, border: `1px solid ${color}22`, marginBottom: 12,
  }}>
    <Text style={{ fontSize: 18, color: '#5a6d85', display: 'block' }}>{label}</Text>
    <Text style={{ fontSize: 26, fontWeight: 700, color, lineHeight: '34px', display: 'block', whiteSpace: 'nowrap' }}>{value}</Text>
    <Text style={{ fontSize: 16, color: '#8c9bb0', display: 'block', minHeight: 20, lineHeight: '20px' }}>{sub || ''}</Text>
  </View>
)
const Row2 = ({ children }: { children: ReactNode }) => (
  <View style={{ display: 'flex', justifyContent: 'space-between' }}>{children}</View>
)
const Section = ({ title, hint }: { title: string; hint?: string }) => (
  <View style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', margin: '4px 0 10px' }}>
    <Text style={{ fontWeight: 600, fontSize: 24, color: PRIMARY }}>{title}</Text>
    {hint ? <Text style={{ fontSize: 17, color: '#8c9bb0', marginLeft: 10 }}>{hint}</Text> : null}
  </View>
)
/** 进度条（对应网页版 antd Progress） */
const Bar = ({ percent, danger = false }: { percent: number; danger?: boolean }) => (
  <View style={{ flex: 1, height: 10, background: '#eef1f5', borderRadius: 6, overflow: 'hidden' }}>
    <View style={{ width: `${Math.min(100, Math.max(0, percent))}%`, height: '100%', background: danger ? '#ff4d4f' : '#1677ff' }} />
  </View>
)
const Tag = ({ text, color }: { text: string; color: string }) => (
  <Text style={{ fontSize: 18, color: '#fff', background: color, borderRadius: 4, padding: '2px 8px' }}>{text}</Text>
)

/** 待生产池 / 超期订单明细行（超期整行浅红，与网页版 table-row-overdue 一致） */
const OrderRow = ({ r, mode }: { r: PendingRowBrief; mode: 'pool' | 'overdue' }) => (
  <View style={{
    border: '1px solid #dfe6f0', borderTopWidth: 0, padding: '10px 12px',
    background: r.overdue ? '#fff1f0' : '#fff',
  }}>
    <View style={{ display: 'flex', alignItems: 'center' }}>
      <Text style={{ fontFamily: 'monospace', fontSize: 22, color: PRIMARY, fontWeight: 600 }}>{r.id}</Text>
      <Tag text={r.statusLabel} color={STATUS_COLOR[r.statusLabel] || '#8c9bb0'} />
      {r.overdue ? <Text style={{ fontSize: 18, color: '#ff4d4f', marginLeft: 'auto' }}>超期 {Math.round(r.elapsedDays - r.limitDays)} 天</Text> : null}
    </View>
    <View style={{ fontSize: 18, color: '#5a6d85', marginTop: 4 }}>{r.productName || '—'} · {r.customerName || '—'}</View>
    <View style={{ display: 'flex', fontSize: 18, marginTop: 4 }}>
      {mode === 'pool' ? (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text>待生产 <Text style={{ color: '#fa8c16', fontWeight: 600 }}>{fmt(r.pendingQty)}</Text></Text>
        </View>
      ) : (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text>已用时 <Text style={{ color: '#ff4d4f', fontWeight: 600 }}>{r.elapsedDays} 天</Text></Text>
        </View>
      )}
      {mode === 'pool' ? (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text>未排期 <Text style={{ color: r.remainScheduleQty > 0 ? '#cf1322' : '#52c41a' }}>{fmt(r.remainScheduleQty)}</Text></Text>
        </View>
      ) : (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text>阈值 {r.limitDays} 天</Text>
        </View>
      )}
      <Text style={{ width: '30%', textAlign: 'right', color: r.overdue ? '#ff4d4f' : '#5a6d85' }}>{r.nodeName || '—'}</Text>
    </View>
    <View style={{ display: 'flex', alignItems: 'center', fontSize: 18, color: '#8c9bb0', marginTop: 4 }}>
      <Text style={{ whiteSpace: 'nowrap' }}>完工率 {r.progress}%</Text>
      <View style={{ width: 70, margin: '0 6px' }}><Bar percent={r.progress} /></View>
      <Text style={{ flex: 1, minWidth: 0, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>负责人 {r.person || '—'}</Text>
    </View>
  </View>
)

/** 维度分布行：手机宽度不够“名-值-条-备注”四列横排，改两行（主行名称+数值，副行进度条+备注） */
const DimTable = ({ title, hint, rows }: {
  title: string; hint?: string
  rows: { name: string; main: string; extra?: string; percent?: number }[]
}) => (
  <View>
    <Section title={title} hint={hint} />
    {rows.length === 0 ? <Text style={{ fontSize: 20, color: '#c0c6cf' }}>暂无数据</Text> : null}
    {rows.map((r, i) => (
      <View key={`${r.name}-${i}`} style={{ borderTop: i ? '1px solid #f0f2f5' : 'none', padding: '8px 0' }}>
        <View style={{ display: 'flex', alignItems: 'baseline' }}>
          <Text style={{ flex: 1, minWidth: 0, fontSize: 20, color: '#333', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</Text>
          <Text style={{ fontSize: 20, color: PRIMARY, marginLeft: 10, whiteSpace: 'nowrap' }}>{r.main}</Text>
        </View>
        <View style={{ display: 'flex', alignItems: 'center', marginTop: 5 }}>
          <View style={{ flex: 1, minWidth: 0 }}>{r.percent !== undefined ? <Bar percent={r.percent} /> : null}</View>
          {r.extra ? <Text style={{ width: '52%', fontSize: 16, color: '#8c9bb0', textAlign: 'right', marginLeft: 10 }}>{r.extra}</Text> : null}
        </View>
      </View>
    ))}
  </View>
)

const PendingStatsCard = ({ data }: { data: PendingStats | null }) => {
  const [tab, setTab] = useState('pool')
  if (!data) return null
  const { totals, bom, risk, nodes, persons, styles, colors, sizes, capacity, efficiency } = data
  const specTotal = (list: { qty: number }[]) => list.reduce((s, x) => s + x.qty, 0) || 1

  return (
    <View className="card" style={{ padding: '20px 24px' }}>
      {/* 标题与元信息分两行：375pt 下同一行会把 28px 标题挤成逐字竖排（实测） */}
      <Text style={{ fontSize: 28, fontWeight: 600, color: PRIMARY, display: 'block' }}>📥 待生产数据统计</Text>
      <Text style={{ fontSize: 16, color: '#8c9bb0', display: 'block', marginTop: 4 }}>
        共 {totals.allCount} 张生产订单 · 数据时间 {data.generatedAt}
      </Text>
      <Text style={{ fontSize: 16, color: '#8c9bb0', display: 'block', lineHeight: '22px', marginTop: 6 }}>
        超期阈值 = 流程节点预计用时之和，未维护时按默认 7 天；待生产数量 = 计划数量 − 完工数量；未排期数量 = 计划数量 − 已排期数量
      </Text>

      {/* 五页签（与网页版 Tabs 同名同序） */}
      <ScrollView scrollX style={{ whiteSpace: 'nowrap', margin: '12px -24px 12px', padding: '0 24px' }}>
        {TABS.map(t => (
          <Text
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              display: 'inline-block', marginRight: 12, padding: '8px 20px', borderRadius: 8, fontSize: 22,
              background: tab === t.key ? PRIMARY : '#eef1f5', color: tab === t.key ? '#fff' : '#5a6d85',
            }}
          >
            {t.label}
          </Text>
        ))}
      </ScrollView>

      {tab === 'pool' && (
        <View>
          <Row2>
            <Metric label="待生产订单数" value={totals.poolCount} color="#fa8c16" bg="#fff7e6"
              sub={`待排产 ${totals.pendingCount} · 生产中 ${totals.processingCount} · 异常 ${totals.warningCount}`} />
            <Metric label="待生产总数量" value={fmt(totals.poolQty)}
              sub={`计划 ${fmt(totals.planQty)} · 已完工 ${fmt(totals.doneQty)}`} />
          </Row2>
          <Row2>
            <Metric label="未排期数量" value={fmt(totals.unscheduledQty)} color="#cf1322" bg="#fff1f0"
              sub={`${totals.unscheduledCount} 单仍有未排数量 · 排期覆盖 ${efficiency.scheduleRate}%`} />
            <Metric label="暂不生产订单" value={totals.deferredCount} color="#8c9bb0" bg="#f7f9fc"
              sub={`占用待排数量 ${fmt(totals.deferredQty)}`} />
          </Row2>
          <Row2>
            <Metric label="超期订单" value={`${risk.overdueCount}单/${risk.overdueRate}%`} color="#cf1322" bg="#fff1f0"
              sub={`平均超 ${risk.avgOverDays} 天 · 最长 ${risk.maxOverDays} 天`} />
            <Metric label="前道阻塞订单" value={bom.blockedCount} color="#fa541c" bg="#fff2e8"
              sub="清单未齐套或半成品未回厂" />
          </Row2>
          <Row2>
            <Metric label="节点停留超时" value={risk.nodeOverCount} color="#d48806" bg="#fffbe6"
              sub={`3 天内到期未完工 ${risk.dueSoonCount} 单 · 已过完工日期 ${risk.planEndPassedCount} 单`} />
            <Metric label="平均完工率" value={`${totals.avgProgress}%`} color="#52c41a" bg="#f6ffed"
              sub={`未填计划完工日期 ${risk.noPlanEndCount} 单`} />
          </Row2>
          <Section title="待生产订单明细" hint={`待生产数量降序，最多 20 单（共 ${totals.poolCount} 单）`} />
          {data.poolTop.length === 0
            ? <Text style={{ fontSize: 20, color: '#c0c6cf' }}>暂无待生产订单（生产订单全部完工或数量为 0）</Text>
            : data.poolTop.map(r => <OrderRow key={r.id} r={r} mode="pool" />)}
        </View>
      )}

      {tab === 'bom' && (
        <View>
          <Row2>
            <Metric label="物料清单未生成" value={bom.noCgsqCount} color="#cf1322" bg="#fff1f0"
              sub="待生产订单中尚未生成采购申请单" />
            <Metric label="加工清单未生成" value={bom.noJgCount} color="#d48806" bg="#fffbe6"
              sub="待生产订单中尚未生成加工订单" />
          </Row2>
          <Row2>
            <Metric label="半成品未回厂" value={`${bom.jgOpenCount}单/${fmt(bom.jgOpenQty)}`} color="#fa541c" bg="#fff2e8"
              sub={`在途加工金额 ¥${fmt(Math.round(bom.jgOpenAmount))}`} />
            <Metric label="半成品加工完成率" value={`${bom.jgDoneRate}%`} color="#52c41a" bg="#f6ffed"
              sub={`加工单 ${bom.jgDoneCount}/${bom.jgTotalCount} 已完成`} />
          </Row2>
          {bom.cgsqOpenCount > 0 && (
            <View style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8, padding: '10px 14px', fontSize: 20, color: '#d48806' }}>
              待生产订单还有 {bom.cgsqOpenCount} 张采购申请单处于「待采购」（申请数量合计 {fmt(bom.cgsqOpenQty)}），原材料未到位将直接卡住开线
            </View>
          )}
          <Section title="齐套概览" hint={`清单齐套 ${bom.readyCount} 单 · 前道阻塞 ${bom.blockedCount} 单`} />
          <View style={{ background: '#f7f9fc', borderRadius: 8, padding: '12px 16px', fontSize: 20, color: '#5a6d85', lineHeight: '34px' }}>
            <View>· 未生成物料清单：{bom.noCgsqCount} 单</View>
            <View>· 未生成加工清单：{bom.noJgCount} 单</View>
            <View>· 未回厂半成品数量：{fmt(bom.jgOpenQty)}（金额 ¥{fmt(Math.round(bom.jgOpenAmount))}）</View>
            <View>· 未完结采购申请：{bom.cgsqOpenCount} 张 / 申请数量 {fmt(bom.cgsqOpenQty)}</View>
          </View>
        </View>
      )}

      {tab === 'risk' && (
        <View>
          <Row2>
            <Metric label="超期订单 / 占比" value={`${risk.overdueCount}单/${risk.overdueRate}%`} color="#cf1322" bg="#fff1f0"
              sub="已用时 > 节点预计用时合计（未填按 7 天）" />
            <Metric label="平均超期天数" value={`${risk.avgOverDays} 天`} color="#d4380d" bg="#fff2e8"
              sub={`最长 ${risk.maxOverDays} 天`} />
          </Row2>
          <Row2>
            <Metric label="节点停留超时" value={risk.nodeOverCount} color="#d48806" bg="#fffbe6"
              sub="当前节点实际停留 > 节点预计用时" />
            <Metric label="交期风险" value={risk.dueSoonCount} color="#1677ff" bg="#e6f4ff"
              sub={`3 天内到期未完工 · 已过完工日期 ${risk.planEndPassedCount} 单 · 未填完工日期 ${risk.noPlanEndCount} 单`} />
          </Row2>
          <DimTable title="各节点在制分布" hint="来源：生产订单流程节点" rows={nodes.map(n => ({
            name: n.name, main: `${n.count} 单 / ${fmt(n.qty)}`,
            extra: `停留 ${n.avgStayDays}天${n.estDays ? ` / 预计 ${n.estDays}天` : ''}${n.overCount ? ` · 超时 ${n.overCount}` : ''}`,
            percent: totals.poolCount ? Math.round((n.count / totals.poolCount) * 100) : 0,
          }))} />
          <Section title="超期订单 Top" hint="按超出阈值天数降序，最多 10 单" />
          {data.overdueTop.length === 0
            ? <Text style={{ fontSize: 20, color: '#c0c6cf' }}>没有超期订单</Text>
            : data.overdueTop.map(r => <OrderRow key={r.id} r={r} mode="overdue" />)}
        </View>
      )}

      {tab === 'capacity' && (
        <View>
          <Row2>
            <Metric label="未来 7 天可排容量" value={fmt(capacity.capacity7)}
              sub={capacity.hasStandard ? '按各线单班次标准产量 × 3 班次 × 7 天' : '未维护标准产量，按近 14 天单班次实际均产估算'} />
            <Metric label="未排期数量" value={fmt(capacity.unscheduledQty)} color="#fa8c16" bg="#fff7e6"
              sub="待生产订单计划数量 − 已排期数量" />
          </Row2>
          <Row2>
            <Metric
              label={capacity.gap > 0 ? '7 天容量缺口' : '7 天容量富余'} value={fmt(Math.abs(capacity.gap))}
              color={capacity.gap > 0 ? '#cf1322' : '#52c41a'} bg={capacity.gap > 0 ? '#fff1f0' : '#f6ffed'}
              sub={capacity.gap > 0 ? '未排期数量超出未来 7 天可排容量' : '未来 7 天容量足以消化未排期数量'}
            />
            <Metric label="待排积压天数" value={capacity.backlogDays === null ? '—' : `${capacity.backlogDays} 天`}
              color="#1677ff" bg="#e6f4ff" sub={`共 ${capacity.lineCount} 条生产线参与计算`} />
          </Row2>
          <DimTable title="各生产线产能与负荷" hint="标准产量在网页版排期看板产线标签处维护" rows={capacity.lines.map(l => ({
            name: l.line, main: `7天 ${fmt(l.capacity7)}`,
            extra: `已排 ${fmt(l.scheduled7)} / ${l.standard > 0 ? `标准 ${fmt(l.standard)}` : `均产 ${fmt(l.avgShiftOutput)}`}`,
            percent: l.capacity7 > 0 ? Math.round((l.scheduled7 / l.capacity7) * 100) : 0,
          }))} />
          <DimTable title="未来 7 天排产负荷" hint="已排数量 vs 当日可排容量（3 班次合计）" rows={capacity.days.map(d => ({
            name: d.label, main: fmt(d.scheduled),
            extra: d.capacity > 0 ? `可排 ${fmt(d.capacity)}` : '未维护产量',
            percent: d.capacity > 0 ? Math.round((d.scheduled / d.capacity) * 100) : 0,
          }))} />
        </View>
      )}

      {tab === 'struct' && (
        <View>
          <Row2>
            <Metric label="近 30 天完工订单" value={efficiency.done30Count} color="#52c41a" bg="#f6ffed"
              sub={`完工数量 ${fmt(efficiency.done30Qty)}`} />
            <Metric label="平均完工周期" value={efficiency.avgCycleDays === null ? '—' : `${efficiency.avgCycleDays} 天`}
              sub="完工日期 − 创建日期（完工日期取生产入库统计）" />
          </Row2>
          <Row2>
            <Metric label="订单完工率" value={`${efficiency.completeRate}%`} color="#1677ff" bg="#e6f4ff"
              sub={`全部 ${totals.allCount} 单中已完工 ${totals.doneCount} 单（已拆分单不计入）`} />
            <Metric label="排期覆盖率" value={`${efficiency.scheduleRate}%`} color="#fa8c16" bg="#fff7e6"
              sub="待生产池已排期数量 / 计划数量" />
          </Row2>
          <DimTable title="负责人待生产分布" hint="待生产数量降序" rows={persons.map(p => ({
            name: p.name, main: fmt(p.qty), extra: `${p.count} 单${p.overdueCount ? ` · 超期 ${p.overdueCount}` : ''}`,
            percent: totals.poolQty ? Math.round((p.qty / totals.poolQty) * 100) : 0,
          }))} />
          <DimTable title="款式待生产 Top 10" hint="来源：生产订单计划明细" rows={styles.map(s => ({
            name: s.styleCode, main: fmt(s.qty), extra: `${s.orderCount} 单 · ${s.colors} 色 · ${s.sizes} 码`,
            percent: totals.poolQty ? Math.round((s.qty / totals.poolQty) * 100) : 0,
          }))} />
          <DimTable title="颜色结构占比" hint="待生产数量结构" rows={colors.map(c => ({
            name: c.name, main: fmt(c.qty), extra: `${c.orderCount} 行`,
            percent: Math.round((c.qty / specTotal(colors)) * 100),
          }))} />
          <DimTable title="尺码结构占比" hint="待生产数量结构" rows={sizes.map(c => ({
            name: c.name, main: fmt(c.qty), extra: `${c.orderCount} 行`,
            percent: Math.round((c.qty / specTotal(sizes)) * 100),
          }))} />
        </View>
      )}
    </View>
  )
}

export default PendingStatsCard
