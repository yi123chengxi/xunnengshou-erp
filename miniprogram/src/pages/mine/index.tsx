import { useEffect, useState } from 'react'
import './index.scss'
import { View, Text, Button } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { getUser, SessionUser } from '../../services/session'
import { logout } from '../../services/auth'
import { getProfile, CompanyProfile } from '../../services/api'
import { refreshChatUnread, onChatUnread } from '../../services/chatBadge'
import AppTabBar from '../../components/AppTabBar'

const ROLE_TEXT: Record<string, string> = {
  supplier: '供应商', purchaser: '采购商', factory: '加工厂', both: '供应商+采购商', admin: '管理员',
}

// 行内卡片样式：weapp 下全局类会压过行内覆盖，尺寸类控件一律行内自带外观（与列表页同口径）
const CARD = { background: '#fff', borderRadius: 12, margin: '12px 16px 0', padding: '2px 16px', boxShadow: '0 1px 4px rgba(31,39,51,0.04)', overflow: 'hidden' } as const
const ROW = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f2f4f7' } as const
const LBL = { fontSize: 15, color: '#8a94a6', flexShrink: 0, marginRight: 12 } as const
const VAL = { flex: 1, fontSize: 15, textAlign: 'right', color: '#1f2733', wordBreak: 'break-all' } as const
const BADGE = { flexShrink: 0, minWidth: 17, height: 17, lineHeight: '17px', padding: '0 5px', borderRadius: 9, background: '#ff4d4f', color: '#fff', fontSize: 11, textAlign: 'center', boxSizing: 'border-box', overflow: 'hidden', whiteSpace: 'nowrap' } as const

// 账号卡信息行：字段清单与网页版右上角「企业信息」弹窗基本信息同口径，空值行不显示
const profileRows = (p: CompanyProfile | null, u: SessionUser | null): [string, string][] => {
  const v = (a?: string, b?: string) => String(a || b || '').trim()
  return ([
    ['账号', v(u?.username, p?.username)],
    ['角色', u ? (ROLE_TEXT[u.role] || u.role) : ''],
    ['公司名称', v(p?.companyName, u?.company_name)],
    ['联系人', p?.contactPerson || ''],
    ['联系电话', p?.phone || ''],
    ['经营地址', p?.address || ''],
    ['法人代表', p?.legalPerson || ''],
    ['公司编号', p?.companyNo || ''],
    ['单号前缀', p?.orderPrefix || ''],
    ['纳税人识别码', p?.taxpayerCode || ''],
    ['电子邮箱', p?.email || ''],
    ['注册日期', p?.registerDate || ''],
    ['数据归属', u?.owner || ''],
  ] as [string, string][]).filter(([, val]) => val)
}

// 我的：我的消息入口 + 企业信息（与网页版企业信息弹窗同源字段）+ 退出登录
const Mine = () => {
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [unread, setUnread] = useState(0)
  const user = getUser()

  const load = () => {
    void refreshChatUnread()
    getProfile()
      .then(d => { if (d && d.profile) setProfile(d.profile) })
      .catch(() => { /* 预览模式/网络异常静默：账号卡以会话字段兜底 */ })
  }
  useEffect(() => {
    load()
    return onChatUnread(setUnread)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useDidShow(load)

  const onLogout = () => {
    Taro.showModal({
      title: '提示',
      content: '确定退出登录吗？',
      success: r => { if (r.confirm) logout() },
    })
  }

  const rows = profileRows(profile, user)
  const statusColor = profile?.status === '已审核' ? '#52c41a' : profile?.status === '已拒绝' ? '#f5222d' : '#fa8c16'

  return (
    <View style={{ paddingBottom: 140 }}>
      <View style={{ background: 'linear-gradient(135deg,#1677ff,#4096ff)', padding: '48px 32px', color: '#fff' }}>
        <Text style={{ fontSize: 40, fontWeight: 600, display: 'block' }}>{user?.name || user?.username || '未登录'}</Text>
        <Text style={{ fontSize: 24, opacity: 0.85 }}>
          {user?.company_name || ''} {user ? `· ${ROLE_TEXT[user.role] || user.role}` : ''}
        </Text>
      </View>

      {/* 我的消息：点开进会话列表；有未读时入口行与底部「我的」键同口径气泡提醒 */}
      <View style={CARD}>
        <View
          style={{ display: 'flex', alignItems: 'center', padding: '13px 0' }}
          onClick={() => Taro.navigateTo({ url: '/pages/messages/index' })}
        >
          <Text style={{ fontSize: 22, lineHeight: '26px' }}>💬</Text>
          <Text style={{ fontSize: 16, marginLeft: 10 }}>我的消息</Text>
          <View style={{ flex: 1 }} />
          {unread > 0 ? <Text style={BADGE}>{unread > 99 ? '99+' : unread}</Text> : null}
          <Text style={{ marginLeft: 8, fontSize: 15, color: '#9aa3ad' }}>›</Text>
        </View>
      </View>

      {/* 微信绑定管理：查看/解绑本微信已绑定的公司账号（与网页个人中心同源） */}
      <View style={CARD}>
        <View
          style={{ display: 'flex', alignItems: 'center', padding: '13px 0' }}
          onClick={() => Taro.navigateTo({ url: '/pages/wx-bindings/index' })}
        >
          <Text style={{ fontSize: 22, lineHeight: '26px' }}>🔗</Text>
          <Text style={{ fontSize: 16, marginLeft: 10 }}>微信绑定管理</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ marginLeft: 8, fontSize: 15, color: '#9aa3ad' }}>›</Text>
        </View>
      </View>

      {/* 账号/企业信息：与网页版企业信息弹窗同字段（空值行不显示），进入页面拉取实时信息 */}
      <View style={CARD}>
        {rows.map(([k, v]) => (
          <View key={k} style={ROW}>
            <Text style={LBL}>{k}</Text>
            <Text style={VAL}>{v}</Text>
          </View>
        ))}
        {profile?.status ? (
          <View style={ROW}>
            <Text style={LBL}>审核状态</Text>
            <Text style={{ ...VAL, color: statusColor }}>{profile.status}</Text>
          </View>
        ) : null}
        {profile?.authorizedUntil ? (
          <View style={ROW}>
            <Text style={LBL}>软件有效期</Text>
            <Text style={{ ...VAL, color: '#1677ff' }}>至 {profile.authorizedUntil}</Text>
          </View>
        ) : null}
        <View style={ROW}>
          <Text style={LBL}>版本</Text>
          <Text style={VAL}>v1.0.0</Text>
        </View>
      </View>

      <View style={{ padding: '16px 24px 0' }}>
        <Button className="btn-danger" onClick={onLogout}>退出登录</Button>
      </View>
      <AppTabBar current="mine" />
    </View>
  )
}

export default Mine
