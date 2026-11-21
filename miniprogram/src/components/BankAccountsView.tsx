import { useState, useEffect } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getBankAccounts, BankAccount, BankTxn } from '../services/api'

const money = (v: number): string => `¥${(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`

/** 状态标签配色：正常绿、冻结/停用红、其余灰 */
const statusTone = (s: string): string => {
  if (!s) return 'tag-gray'
  if (/正常|启用/.test(s)) return 'tag-green'
  if (/冻结|停用|注销|异常/.test(s)) return 'tag-red'
  return 'tag-gray'
}

/** 账户类型底色：逐字照抄网页版 ModuleChildPage 银行账户 accountType 列的 Tag 色板（色底 + 白字） */
const TYPE_BG: Record<string, string> = {
  基本账户: '#722ed1',
  一般账户: '#52c41a',
  个人账户: '#faad14',
  支付宝: '#1677ff',
  微信: '#52c41a',
}

// —— 行内样式常量（weapp 中类选择器会压过行内样式，精细控件统一纯行内）——
const SEARCH_BAR = { display: 'flex', padding: '16px 24px 0', alignItems: 'center' } as const
const SEARCH_INPUT = { flex: 1, marginBottom: 0, height: 36, lineHeight: '36px', fontSize: 17, padding: '0 11px', background: '#ffffff', border: '1px solid #c9d4e3', borderRadius: 8, boxSizing: 'border-box' } as const
const SEARCH_BTN = { marginLeft: 8, height: 36, lineHeight: '36px', padding: '0 16px', fontSize: 15, color: '#ffffff', background: '#1677ff', borderRadius: 8, textAlign: 'center', flexShrink: 0, boxSizing: 'border-box' } as const
// 汇总条：浅蓝底色圆角条，字体缩小 30%（22→15 / 24→17）
const SUMMARY = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '12px 24px 0', padding: '10px 16px', borderRadius: 10, background: '#e6f4ff' } as const
const SUMMARY_LBL = { color: '#4d6b8a', fontSize: 15 } as const
const SUMMARY_AMT = { fontSize: 17, fontWeight: 700, color: '#1f2733' } as const
const CARD = { background: '#ffffff', borderRadius: 16, margin: '16px 24px', padding: '16px 24px', boxShadow: '0 2px 8px rgba(31,39,51,0.04)' } as const
const C_ROW = { display: 'flex', alignItems: 'center' } as const
const C_ROW2 = { display: 'flex', alignItems: 'center', marginTop: 4, overflow: 'hidden' } as const
const C_NAME = { flex: 1, minWidth: 0, fontWeight: 600, fontSize: 17, lineHeight: '24px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } as const
const C_SUB = { color: '#8a94a6', fontSize: 14, lineHeight: '20px' } as const
const C_NO = { flex: 1, minWidth: 0, fontSize: 14, lineHeight: '20px', fontFamily: 'monospace', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } as const
const C_TAG = { marginLeft: 8, flexShrink: 0, display: 'inline-block', fontSize: 13, lineHeight: '19px', padding: '0 8px', borderRadius: 6 } as const
// 账户类型小标签：字号与状态标签一致，白字压在色底上（同网页版）
const C_TYPE = { flexShrink: 0, marginLeft: 10, display: 'inline-block', fontSize: 13, lineHeight: '19px', padding: '0 8px', borderRadius: 6, fontWeight: 500, color: '#ffffff' } as const
const C_BAL = { flex: 1, minWidth: 0, fontWeight: 700, fontSize: 18, lineHeight: '25px', color: '#1f2733' } as const
const DETAIL_BTN = { marginLeft: 12, flexShrink: 0, height: 32, lineHeight: '32px', padding: '0 14px', background: '#1677ff', color: '#ffffff', fontSize: 12, borderRadius: 16, textAlign: 'center' } as const
// 复制按键：与查看明细同尺寸的次要样式（白底浅蓝边蓝字）；内边距略紧以免余额位数多时挤掉右侧按键
const COPY_BTN = { marginLeft: 8, flexShrink: 0, height: 32, lineHeight: '30px', padding: '0 10px', background: '#ffffff', color: '#1677ff', border: '1px solid #91caff', fontSize: 12, borderRadius: 16, textAlign: 'center', boxSizing: 'border-box' } as const
const MASK = { position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000 } as const
const SHEET = { position: 'fixed', left: 0, right: 0, bottom: 0, background: '#f7f9fb', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '0 20px 28px', zIndex: 1001, maxHeight: '78%', boxSizing: 'border-box', overflowY: 'scroll' } as const
const SHEET_HEAD = { display: 'flex', alignItems: 'center', paddingTop: 16 } as const
const SHEET_TITLE = { flex: 1, minWidth: 0, fontSize: 16, fontWeight: 600, color: '#1f2733', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } as const
const CLOSE_X = { flexShrink: 0, marginLeft: 12, fontSize: 20, color: '#86909c', lineHeight: '22px' } as const
const INFO_BLOCK = { marginTop: 12, background: '#ffffff', borderRadius: 10, padding: '4px 12px', overflow: 'hidden' } as const
const INFO_ROW = { display: 'flex', alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px solid #f2f4f7' } as const
const INFO_LBL = { flexShrink: 0, width: 66, fontSize: 13, color: '#86909c', lineHeight: '19px' } as const
const INFO_VAL = { flex: 1, minWidth: 0, fontSize: 13, color: '#1f2733', lineHeight: '19px', wordBreak: 'break-all' } as const
const SEC_TITLE = { margin: '14px 0 8px', fontSize: 14, fontWeight: 600, color: '#1f2733' } as const
const TXN_BOX = { background: '#ffffff', borderRadius: 10, overflow: 'hidden' } as const
const TXN_ROW = { padding: '8px 12px', borderBottom: '1px solid #f2f4f7' } as const
const TXN_L1 = { display: 'flex', alignItems: 'center' } as const
const TXN_TYPE = { flexShrink: 0, marginRight: 8, padding: '0 8px', borderRadius: 8, fontSize: 11, lineHeight: '18px', color: '#ffffff' } as const
const TXN_TIME = { flex: 1, minWidth: 0, fontSize: 12, color: '#86909c', overflow: 'hidden' } as const
const TXN_AMT = { flexShrink: 0, marginLeft: 8, fontSize: 14, fontWeight: 600 } as const
const TXN_L2 = { display: 'flex', alignItems: 'center', marginTop: 3 } as const
const TXN_REMARK = { flex: 1, minWidth: 0, fontSize: 12, color: '#5a6d85', lineHeight: '17px', overflow: 'hidden' } as const
const TXN_BAL = { flexShrink: 0, marginLeft: 8, fontSize: 11, color: '#a0a8b8' } as const
const EMPTY_TXN = { padding: '18px 0', textAlign: 'center', fontSize: 13, color: '#86909c' } as const

/**
 * 银行账户视图：与 Web 财务管理→银行账户同源（pageData_finance_bank-account_<owner>），只读。
 * 卡片：账户名称 / 开户银行+银行账号 / 支行名称+账户类型（靠右） / 余额+复制+查看明细；点明细看该账户交易流水。
 * 搜索为「点查询后生效」双态模式，与通用列表口径一致。
 */
const BankAccountsView = ({ tick = 0 }: { tick?: number }) => {
  const [input, setInput] = useState('')
  const [applied, setApplied] = useState('')
  const [list, setList] = useState<BankAccount[]>([])
  const [total, setTotal] = useState(0)
  const [totalBalance, setTotalBalance] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState('')
  const [detail, setDetail] = useState<BankAccount | null>(null)

  useEffect(() => {
    setLoaded(false)
    getBankAccounts(applied)
      .then(d => {
        setList(d.list || [])
        setTotal(d.total || 0)
        setTotalBalance(d.totalBalance || 0)
        setFailed('')
      })
      .catch(e => {
        // 服务端未部署该接口时保留页面结构并给出提示，不弹错打断浏览
        setList([])
        setTotal(0)
        setTotalBalance(0)
        setFailed(String(e && e.message ? e.message : '加载失败'))
      })
      .finally(() => setLoaded(true))
  }, [applied, tick])

  const copyNo = (acc: BankAccount) => {
    if (!acc.bankAccountNo) return
    Taro.setClipboardData({ data: acc.bankAccountNo })
  }

  /** 一键复制账户信息：账户名称/开户银行/银行账号/支行名称四行（无值字段跳过，避免粘贴出一堆空标签） */
  const copyAll = (acc: BankAccount) => {
    const pairs: Array<[string, string]> = [
      ['账户名称', acc.name || ''],
      ['开户银行', acc.bankName || ''],
      ['银行账号', acc.bankAccountNo || ''],
      ['支行名称', acc.branchName || ''],
    ]
    const data = pairs.filter(([, v]) => String(v).trim()).map(([k, v]) => `${k}：${String(v).trim()}`).join('\n')
    if (!data) return
    Taro.setClipboardData({ data })
  }

  const txns: BankTxn[] = Array.isArray(detail?.transactions) ? detail.transactions : []

  return (
    <View>
      <View style={{ ...SEARCH_BAR }}>
        <Input
          style={{ ...SEARCH_INPUT }}
          placeholder="搜索账户名称/开户银行/银行账号"
          placeholderStyle="color:#9aa3ad;font-size:17px"
          value={input}
          onInput={e => setInput(e.detail.value)}
          onConfirm={() => setApplied(input.trim())}
        />
        {/* 行内按键：纯行内样式不带 btn-primary 类（类里 84px 行高/30px 字会压过行内覆盖导致按键过大） */}
        <View style={{ ...SEARCH_BTN }} onClick={() => setApplied(input.trim())}>
          查询
        </View>
      </View>

      {/* 汇总条：浅蓝底色圆角条，账户数 + 总余额（与筛选结果同源，随查询变化） */}
      {loaded && (
        <View style={{ ...SUMMARY }}>
          <Text style={{ ...SUMMARY_LBL }}>共 {total} 个账户</Text>
          <Text style={{ ...SUMMARY_LBL }}>
            总余额 <Text style={{ ...SUMMARY_AMT, color: totalBalance < 0 ? '#ff4d4f' : '#1f2733' }}>{money(totalBalance)}</Text>
          </Text>
        </View>
      )}

      {loaded && !failed && list.length === 0 && (
        <View className="empty">{applied ? '未找到匹配的银行账户' : '暂无银行账户，请先在网页端财务管理→银行账户维护'}</View>
      )}
      {loaded && failed && <View className="empty">银行账户数据暂不可用（{failed}）</View>}

      {/* 卡片不挂 .card 类（类里 padding:24 会压过行内值），背景/圆角/阴影/外边距全量行内声明 */}
      {list.map(acc => (
        <View key={String(acc.key || `${acc.name}-${acc.bankAccountNo}`)} style={{ ...CARD }}>
          {/* 第一行：账户名称 + 状态 */}
          <View style={{ ...C_ROW }}>
            <Text style={{ ...C_NAME }}>
              {acc.name || '未命名账户'}
              {acc.shortName ? <Text style={{ color: '#8a94a6', fontWeight: 400, fontSize: 14, marginLeft: 8 }}>{acc.shortName}</Text> : null}
            </Text>
            {acc.status ? <Text className={statusTone(acc.status)} style={{ ...C_TAG }}>{acc.status}</Text> : null}
          </View>
          {/* 第二行：开户银行 + 银行账号（点击账号复制） */}
          <View style={{ ...C_ROW2 }}>
            <Text style={{ ...C_SUB, flexShrink: 0 }}>{acc.bankName || '—'}</Text>
            <Text
              style={{ ...C_NO, marginLeft: 10 }}
              onClick={() => copyNo(acc)}
            >
              {acc.bankAccountNo || '—'}
            </Text>
          </View>
          {/* 第三行：支行名称居左，账户类型靠右（配色同网页版：色底白字，未知类型走浅灰底，空值只显短横） */}
          <View style={{ marginTop: 4, display: 'flex', alignItems: 'center' }}>
            <Text style={{ ...C_SUB, flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>支行 {acc.branchName || '—'}</Text>
            {acc.accountType ? (
              <Text style={{ ...C_TYPE, background: TYPE_BG[acc.accountType] || '#f0f0f0', color: TYPE_BG[acc.accountType] ? '#ffffff' : '#8c8c8c' }}>{acc.accountType}</Text>
            ) : (
              <Text style={{ ...C_SUB, flexShrink: 0, marginLeft: 10 }}>—</Text>
            )}
          </View>
          {/* 第四行：账户余额 + 复制按键 + 查看明细按键 */}
          <View style={{ ...C_ROW, marginTop: 8 }}>
            <Text style={{ ...C_BAL, color: acc.balance < 0 ? '#ff4d4f' : '#1f2733' }}>{money(acc.balance)}</Text>
            <View style={{ ...COPY_BTN }} onClick={() => copyAll(acc)}>复制</View>
            <View style={{ ...DETAIL_BTN }} onClick={() => setDetail(acc)}>查看明细</View>
          </View>
        </View>
      ))}

      {loaded && list.length > 0 && (
        <View style={{ color: '#8a94a6', textAlign: 'center', fontSize: 14, padding: '8px 24px 0' }}>点复制可一键拷走账户名称/开户银行/账号/支行，余额与网页端实时同步</View>
      )}

      {/* 银行账户明细弹层：账户信息 + 交易流水 */}
      {detail && (
        <View>
          <View style={{ ...MASK }} onClick={() => setDetail(null)} />
          <View style={{ ...SHEET }}>
            <View style={{ ...SHEET_HEAD }}>
              <Text style={{ ...SHEET_TITLE }} numberOfLines={1}>{detail.name || '账户明细'}</Text>
              <Text style={{ ...CLOSE_X }} onClick={() => setDetail(null)}>×</Text>
            </View>

            <View style={{ ...INFO_BLOCK }}>
              <View style={{ ...INFO_ROW }}>
                <Text style={{ ...INFO_LBL }}>当前余额</Text>
                <Text style={{ ...INFO_VAL, fontSize: 16, fontWeight: 700, color: detail.balance < 0 ? '#ff4d4f' : '#1f2733' }}>{money(detail.balance)}</Text>
              </View>
              <View style={{ ...INFO_ROW }}>
                <Text style={{ ...INFO_LBL }}>开户银行</Text>
                <Text style={{ ...INFO_VAL }}>{detail.bankName || '—'}{detail.branchName ? ` · ${detail.branchName}` : ''}</Text>
              </View>
              <View style={{ ...INFO_ROW }}>
                <Text style={{ ...INFO_LBL }}>银行账号</Text>
                <Text style={{ ...INFO_VAL }} onClick={() => copyNo(detail)}>{detail.bankAccountNo || '—'}</Text>
              </View>
              {detail.person ? (
                <View style={{ ...INFO_ROW }}>
                  <Text style={{ ...INFO_LBL }}>负责人</Text>
                  <Text style={{ ...INFO_VAL }}>{detail.person}</Text>
                </View>
              ) : null}
              {detail.openDate ? (
                <View style={{ ...INFO_ROW, borderBottom: 'none' }}>
                  <Text style={{ ...INFO_LBL }}>开户日期</Text>
                  <Text style={{ ...INFO_VAL }}>{detail.openDate}</Text>
                </View>
              ) : null}
            </View>

            <View style={{ ...SEC_TITLE }}>交易明细（{txns.length}）</View>
            {txns.length === 0 ? (
              <View style={{ ...TXN_BOX }}><View style={{ ...EMPTY_TXN }}>暂无交易明细</View></View>
            ) : (
              <View style={{ ...TXN_BOX }}>
                {txns.map((t, idx) => (
                  <View key={idx} style={{ ...TXN_ROW }}>
                    <View style={{ ...TXN_L1 }}>
                      <Text style={{ ...TXN_TYPE, background: t.type === 'in' ? '#52c41a' : '#ff7a45' }}>{t.type === 'in' ? '收入' : '支出'}</Text>
                      <Text style={{ ...TXN_TIME }} numberOfLines={1}>{String(t.time || '').slice(0, 19)}</Text>
                      <Text style={{ ...TXN_AMT, color: t.type === 'in' ? '#52c41a' : '#e5533c' }}>{t.type === 'in' ? '+' : '-'}{money(t.amount)}</Text>
                    </View>
                    <View style={{ ...TXN_L2 }}>
                      <Text style={{ ...TXN_REMARK }} numberOfLines={2}>{t.remark || t.counterparty || '—'}</Text>
                      {t.balanceAfter !== null && t.balanceAfter !== undefined ? (
                        <Text style={{ ...TXN_BAL }}>余 {money(t.balanceAfter)}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  )
}

export default BankAccountsView
