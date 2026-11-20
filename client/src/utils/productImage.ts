// 产品图片统一解析：多源存储下「有没有图 / 图在哪」的唯一判定入口。
// 图片真源可能落在四处，任何「只同步读 localStorage 缩略图键」的判定都会把有图商品误判成无图：
//   1) 记录里的 image 字段（云端地址，迁移/上传后优先）
//   2) localStorage 缩略图键 prodImg_<归属账号>_<产品key>（列表小图，容量有限易被挤掉）
//   3) IndexedDB 旧共享库 prodImages/imgs（新品研发/BOM 上传，key 就是产品 key 无账号前缀）
//   4) IndexedDB 原图库 factory_erp_images/full_images（key 同缩略图键名）
//   5) 图片空间绑定表 prodImgUrl_<归属账号>（换电脑后本机库为空，靠云端地址还原）
import { getFullImage, getLegacyImage } from './imageStore';
import { absoluteImageUrl, loadImageUrlMap } from './imageSpace';
import { recompressDataUrl } from './imageCompress';

/** 缩略图/原图共用的存储键（归属账号口径统一走 getDataOwner，不能用登录名——子账号会取错前缀） */
export const productImgKeyOf = (owner: string, productKey: string): string => `prodImg_${owner}_${productKey}`;

/** 同步通道：只查记录 image 字段与 localStorage 缩略图，拿不到返回空串（IndexedDB 图片查不到属正常） */
export const productImgSync = (owner: string, productKey: string, recordImage?: string): string => {
  const cloud = absoluteImageUrl(String(recordImage || ''));
  if (cloud) return cloud;
  if (!productKey) return '';
  try { return localStorage.getItem(productImgKeyOf(owner, productKey)) || ''; } catch { return ''; }
};

/** 异步逐级解析产品图片：记录字段 → 缩略图 → 旧共享库 → 原图库 → 图片空间绑定表；全部落空返回空串 */
export const resolveProductImage = async (owner: string, productKey: string, recordImage?: string): Promise<string> => {
  const sync = productImgSync(owner, productKey, recordImage);
  if (sync) return sync;
  if (!productKey) return '';
  const legacy = await getLegacyImage(productKey);
  if (legacy) return legacy;
  const full = await getFullImage(productImgKeyOf(owner, productKey));
  if (full) return full;
  try {
    const bound = loadImageUrlMap(owner)[productKey];
    const url = bound ? absoluteImageUrl(bound) : '';
    if (url) return url;
  } catch { /* ignore */ }
  return '';
};

/** 产品是否存在图片（异步，覆盖全部存储通道） */
export const hasProductImage = async (owner: string, productKey: string, recordImage?: string): Promise<boolean> =>
  !!(await resolveProductImage(owner, productKey, recordImage));

/**
 * 落库/入卡片前瘦身：IndexedDB 里可能存着未压缩原图，直接写 localStorage 会撞配额、
 * 直接嵌进市场卡片会随数据集同步把体积打爆。非 dataURL（云端地址）原样返回。
 */
export const shrinkImgForStore = async (src: string, maxEdge = 800): Promise<string> => {
  if (!src || !src.startsWith('data:image')) return src;
  if (src.length < 120000) return src;
  try { return (await recompressDataUrl(src, maxEdge, 0.78)) || src; } catch { return src; }
};
