import Taro from '@tarojs/taro'
import { request } from './request'

/**
 * 选图并上传到图片空间（POST /api/images，base64 落盘 + Nginx /uploads 静态直出），
 * 返回可直接引用的图片 URL；与 Web 图片空间同一份二进制与索引。
 */
export const chooseAndUploadImage = async (): Promise<string> => {
  const res = await Taro.chooseImage({ count: 1, sizeType: ['compressed'] })
  const filePath = (res.tempFilePaths || [])[0]
  if (!filePath) throw new Error('未选择图片')
  let dataUrl = ''
  if (Taro.getEnv() === Taro.ENV_TYPE.WEAPP) {
    const b64 = Taro.getFileSystemManager().readFileSync(filePath, 'base64') as string
    const ext = (filePath.split('.').pop() || 'jpg').toLowerCase()
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    dataUrl = `data:${mime};base64,${b64}`
  } else {
    // H5：tempFilePath 为 blob: URL，经 FileReader 转 dataUrl
    const blob = await (await fetch(filePath)).blob()
    dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => reject(new Error('图片读取失败'))
      fr.readAsDataURL(blob)
    })
  }
  const asset = await request<{ url: string }>('/images/', {
    method: 'POST',
    data: { dataUrl, name: `wx-${Date.now()}` },
  })
  if (!asset?.url) throw new Error('上传失败')
  return asset.url
}
