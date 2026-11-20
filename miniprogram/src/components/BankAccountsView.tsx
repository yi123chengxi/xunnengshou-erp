import { useState, useEffect } from 'react'
import { View, Text, Input } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { getBankAccounts, BankAccount } from '../services/api'

const money = (v: number): string => `¥${(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`

/** 状态标签配色：正常绿、冻结/停用红、其余灰 */
const statusTone = (s: string): string => {
  if (!s) return 'tag-gray'
  if (/正常|启用/.test(s)) return 'tag-green'
  if (/冻结|停用|注销|异常/.test(s)) return 'tag-red'
  return 'tag-gray'
}

/**
 * 银行账户视图：与 Web 财务管理→银行账户同源（pageData_finance_bank-account_<owner>），
 * 只读展示账户信息与余额，密码类字段服务端已过滤不下发。
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

  return (
    <View>
      <View style={{ display: 'flex', padding: '16px 24px 0', alignItems: 'center' }}>
        <Input
          style={{ flex: 1, marginBottom: 0, height: 36, lineHeight: '36px', fontSize: 17, padding: '0 11px', background: '#f5f6f8', borderRadius: 8, boxSizing: 'border-box' }}
          placeholder="搜索账户名称/开户银行/银行账号"
          placeholderStyle="color:#9aa3ad;font-size:17px"
          value={input}
          onInput={e => setInput(e.detail.value)}
          onConfirm={() => setApplied(input.trim())}
        />
        {/* 行内按键：纯行内样式不带 btn-primary 类（类里 84px 行高/30px 字会压过行内覆盖导致按键过大） */}
        <View
          style={{ marginLeft: 8, height: 36, lineHeight: '36px', padding: '0 16px', fontSize: 15, color: '#fff', background: '#1677ff', borderRadius: 8, textAlign: 'center', flexShrink: 0, boxSizing: 'border-box' }}
          onClick={() => setApplied(input.trim())}
        >
          查询
        </View>
      </View>

      {/* 汇总条：账户数 + 总余额（与筛选结果同源，随查询变化） */}
      {loaded && (
        <View style={{ display: 'flex', alignItems: 'center', padding: '10px 24px 0' }}>
          <Text style={{ color: '#8a94a6', fontSize: 22 }}>共 {total} 个账户</Text>
          <Text style={{ marginLeft: 16, fontSize: 22 }}>
            总余额 <Text style={{ color: totalBalance < 0 ? '#ff4d4f' : '#1f2733', fontWeight: 700, fontSize: 24 }}>{money(totalBalance)}</Text>
          </Text>
        </View>
      )}

      {loaded && !failed && list.length === 0 && (
        <View className="empty">{applied ? '未找到匹配的银行账户' : '暂无银行账户，请先在网页端财务管理→银行账户维护'}</View>
      )}
      {loaded && failed && <View className="empty">银行账户数据暂不可用（{failed}）</View>}

      {/* 卡片不挂 .card 类（类里 padding:24 会压过行内值），背景/圆角/阴影/外边距全量行内声明 */}
      {list.map(acc => (
        <View key={String(acc.key || `${acc.name}-${acc.bankAccountNo}`)} style={{ background: '#fff', borderRadius: 16, margin: '16px 24px', padding: '16px 24px', boxShadow: '0 2px 8px rgba(31,39,51,0.04)' }}>
          {/* 第一行：账户名称 + 余额 */}
          <View style={{ display: 'flex', alignItems: 'center' }}>
            <Text style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 24, lineHeight: '32px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {acc.name || '未命名账户'}
              {acc.shortName ? <Text style={{ color: '#8a94a6', fontWeight: 400, fontSize: 20, marginLeft: 8 }}>{acc.shortName}</Text> : null}
            </Text>
            <Text style={{ marginLeft: 12, flexShrink: 0, fontWeight: 700, fontSize: 26, lineHeight: '32px', color: acc.balance < 0 ? '#ff4d4f' : '#1f2733' }}>
              {money(acc.balance)}
            </Text>
          </View>
          {/* 第二行：开户银行（支行） */}
          <View style={{ marginTop: 4 }}>
            <Text style={{ color: '#8a94a6', fontSize: 20, lineHeight: '28px' }}>
              {acc.bankName || '—'}{acc.branchName ? `（${acc.branchName}）` : ''}
            </Text>
          </View>
          {/* 第三行：银行账号（点击复制）+ 账户类型 */}
          <View style={{ display: 'flex', alignItems: 'center', marginTop: 4 }}>
            <Text
              style={{ flex: 1, minWidth: 0, fontSize: 20, lineHeight: '28px', fontFamily: 'monospace', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
              onClick={() => copyNo(acc)}
            >
              {acc.bankAccountNo || '—'}
            </Text>
            {acc.accountType ? <Text className="tag-blue" style={{ marginLeft: 12, flexShrink: 0, display: 'inline-block', fontSize: 18, lineHeight: '26px', padding: '0 8px', borderRadius: 6 }}>{acc.accountType}</Text> : null}
            {acc.status ? <Text className={statusTone(acc.status)} style={{ marginLeft: 8, flexShrink: 0, display: 'inline-block', fontSize: 18, lineHeight: '26px', padding: '0 8px', borderRadius: 6 }}>{acc.status}</Text> : null}
          </View>
          {/* 第四行：开户日期 · 负责人 · 流水笔数 */}
          <View style={{ marginTop: 4 }}>
            <Text style={{ color: '#8a94a6', fontSize: 18, lineHeight: '26px' }}>
              {[acc.openDate, acc.person && `负责人 ${acc.person}`, acc.txnCount ? `流水 ${acc.txnCount} 笔` : ''].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
      ))}

      {loaded && list.length > 0 && (
        <View style={{ color: '#8a94a6', textAlign: 'center', fontSize: 20, padding: '8px 24px 0' }}>点击银行账号可复制，余额与网页端实时同步</View>
      )}
    </View>
  )
}

export default BankAccountsView
