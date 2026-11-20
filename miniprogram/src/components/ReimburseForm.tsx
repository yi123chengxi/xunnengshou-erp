import { useState } from 'react'
import { View, Text, Input, Textarea, Button, Image } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { createReimbursement } from '../services/api'

// —— 行内样式常量（weapp 中类选择器会压过行内样式；.input/.textarea 类灰底无边框且字号大，全部去类改纯行内）——
const FORM_ROW = { display: 'flex', alignItems: 'center', marginTop: 12 } as const
const FORM_ROW_TOP = { display: 'flex', alignItems: 'flex-start', marginTop: 12 } as const
const FORM_LBL = { flexShrink: 0, width: 84, fontSize: 15, color: '#1f2733', lineHeight: '40px' } as const
const FIELD_INPUT = { flex: 1, minWidth: 0, height: 40, background: '#ffffff', border: '1px solid #c9d4e3', borderRadius: 8, padding: '0 12px', fontSize: 15, boxSizing: 'border-box' } as const
const FIELD_TEXTAREA = { flex: 1, minWidth: 0, height: 88, background: '#ffffff', border: '1px solid #c9d4e3', borderRadius: 8, padding: '10px 12px', fontSize: 15, boxSizing: 'border-box' } as const

// 报销申请表单（内嵌/独立页共用）：手机填单 + 微信相册/拍照传票据；字段名在左、描边输入框在右
const ReimburseForm = ({ embedded = false }: { embedded?: boolean }) => {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [receipts, setReceipts] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const pickImages = async () => {
    try {
      const res = await Taro.chooseImage({ count: 9 - receipts.length, sizeType: ['compressed'], sourceType: ['album', 'camera'] })
      const added: string[] = []
      for (const path of res.tempFilePaths) {
        let finalPath = path
        try {
          const compressed = await Taro.compressImage({ src: path, quality: 60 })
          finalPath = compressed.tempFilePath
        } catch { /* 压缩失败用原图 */ }
        const b64 = Taro.getFileSystemManager().readFileSync(finalPath, 'base64')
        added.push(`data:image/jpeg;base64,${b64}`)
      }
      setReceipts(prev => [...prev, ...added].slice(0, 9))
    } catch { /* 用户取消 */ }
  }

  const reset = () => { setTitle(''); setCategory(''); setAmount(''); setDescription(''); setReceipts([]) }

  const onSubmit = async () => {
    const amt = Number(amount)
    if (!title.trim() || !category.trim() || !(amt > 0)) {
      Taro.showToast({ title: '请填写标题/费用分类/金额(>0)', icon: 'none' })
      return
    }
    if (busy) return
    setBusy(true)
    try {
      await createReimbursement({ title: title.trim(), category: category.trim(), amount: amt, description: description.trim(), receipts })
      Taro.showToast({ title: '已提交，等待审核', icon: 'success' })
      if (embedded) reset()
      else setTimeout(() => Taro.navigateBack(), 600)
    } catch (e: any) {
      Taro.showToast({ title: e.message || '提交失败', icon: 'none' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={{ padding: '16px 24px' }}>
      <View style={{ ...FORM_ROW }}>
        <Text style={{ ...FORM_LBL }}>报销标题</Text>
        <Input style={{ ...FIELD_INPUT }} placeholder="如：10月差旅报销" placeholderStyle="color:#b0bcca" value={title} onInput={e => setTitle(e.detail.value)} />
      </View>
      <View style={{ ...FORM_ROW }}>
        <Text style={{ ...FORM_LBL }}>费用分类</Text>
        <Input style={{ ...FIELD_INPUT }} placeholder="如：差旅费/办公费" placeholderStyle="color:#b0bcca" value={category} onInput={e => setCategory(e.detail.value)} />
      </View>
      <View style={{ ...FORM_ROW }}>
        <Text style={{ ...FORM_LBL }}>金额（元）</Text>
        <Input style={{ ...FIELD_INPUT }} type="digit" placeholder="请输入金额" placeholderStyle="color:#b0bcca" value={amount} onInput={e => setAmount(e.detail.value)} />
      </View>
      <View style={{ ...FORM_ROW_TOP }}>
        <Text style={{ ...FORM_LBL }}>费用说明</Text>
        <Textarea style={{ ...FIELD_TEXTAREA }} placeholder="选填" placeholderStyle="color:#b0bcca" value={description} onInput={e => setDescription(e.detail.value)} />
      </View>

      <View className="card" style={{ margin: '20px 0' }}>
        <View className="card-title">票据（{receipts.length}/9）</View>
        <View style={{ display: 'flex', flexWrap: 'wrap' }}>
          {receipts.map((src, i) => (
            <View key={i} style={{ position: 'relative', marginRight: 12, marginBottom: 12 }}>
              <Image src={src} mode="aspectFill" style={{ width: 160, height: 160, borderRadius: 8 }} />
              <Text
                style={{ position: 'absolute', top: -12, right: -12, background: '#f5222d', color: '#fff', borderRadius: 20, fontSize: 20, padding: '0 10px' }}
                onClick={() => setReceipts(prev => prev.filter((_, idx) => idx !== i))}
              >
                ×
              </Text>
            </View>
          ))}
          {receipts.length < 9 && (
            <View
              style={{ width: 160, height: 160, border: '1px dashed #91a7c9', borderRadius: 8, textAlign: 'center', lineHeight: '160px', color: '#5a6d85' }}
              onClick={pickImages}
            >
              + 拍照/相册
            </View>
          )}
        </View>
      </View>

      <Button className="btn-primary" loading={busy} onClick={onSubmit}>提交申请</Button>
    </View>
  )
}

export default ReimburseForm
