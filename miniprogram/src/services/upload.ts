import Taro from '@tarojs/taro'
import { request } from './request'

/** 本地临时路径转 dataUrl（weapp 走 FileSystemManager，H5 走 FileReader） */
const pathToDataUrl = async (filePath: string): Promise<string> => {
  if (Taro.getEnv() === Taro.ENV_TYPE.WEAPP) {
    const b64 = Taro.getFileSystemManager().readFileSync(filePath, 'base64') as string
    const ext = (filePath.split('.').pop() || 'jpg').toLowerCase()
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${b64}`
  }
  const blob = await (await fetch(filePath)).blob()
  return new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(new Error('图片读取失败'))
    fr.readAsDataURL(blob)
  })
}

/** 上传 dataUrl 到图片空间（POST /api/images），返回可直接引用的 URL */
const uploadDataUrl = async (dataUrl: string): Promise<string> => {
  const asset = await request<{ url: string }>('/images/', {
    method: 'POST',
    data: { dataUrl, name: `wx-${Date.now()}` },
  })
  if (!asset?.url) throw new Error('上传失败')
  return asset.url
}

/** 单张压缩（quality 60，失败回退原图），节省上传与存储空间 */
const compressPath = async (path: string): Promise<string> => {
  try {
    const c = await Taro.compressImage({ src: path, quality: 60 })
    return c.tempFilePath || path
  } catch { return path }
}

/**
 * 选图并上传到图片空间（POST /api/images，base64 落盘 + Nginx /uploads 静态直出），
 * 返回可直接引用的图片 URL；与 Web 图片空间同一份二进制与索引。
 * sourceType 缺省为「相册+拍照」（微信端会弹来源选择）；传 ['camera'] 即直接进相机。
 * 上传前统一压缩（quality 60）以节省空间。
 */
export const chooseAndUploadImage = async (
  sourceType: ('album' | 'camera')[] = ['album', 'camera'],
): Promise<string> => {
  const res = await Taro.chooseImage({ count: 1, sizeType: ['compressed'], sourceType })
  const filePath = (res.tempFilePaths || [])[0]
  if (!filePath) throw new Error('未选择图片')
  const finalPath = await compressPath(filePath)
  return uploadDataUrl(await pathToDataUrl(finalPath))
}

/**
 * 多选图并逐张压缩后上传，返回 URL 数组（最多 count 张）。
 * 用于发货凭证等需要一次上传多张且支持拍照的场景。
 */
export const chooseAndUploadImages = async (
  count = 9,
  sourceType: ('album' | 'camera')[] = ['album', 'camera'],
): Promise<string[]> => {
  const res = await Taro.chooseImage({ count, sizeType: ['compressed'], sourceType })
  const urls: string[] = []
  for (const path of res.tempFilePaths || []) {
    const finalPath = await compressPath(path)
    urls.push(await uploadDataUrl(await pathToDataUrl(finalPath)))
  }
  return urls
}
