import { PropsWithChildren, useEffect } from 'react'
import { restoreSession } from './services/auth'
import './app.scss'

// 小程序入口：挂载时恢复登录态（令牌失效则跳登录页）
const App = ({ children }: PropsWithChildren<any>) => {
  useEffect(() => {
    restoreSession()
  }, [])
  return children
}

export default App
