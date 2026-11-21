// 产品图片统一解析：多源存储下「有没有图 / 图在哪」的唯一判定入口。
// 图片真源可能落在四处，任何「只同步读 localStorage 缩略图键」的判定都会把有图商品误判成无图：
//   1) 记录里的 image 字段（云端地址，迁移/上传后优先）
//   2) localStorage 缩略图键 prodImg_<归属账号>_<产品key>（列表小图，容量有限易被挤掉）
//   3) IndexedDB 旧共享库 prodImages/imgs（新品研发/BOM 上传，key 就是产品 key 无账号前缀）
//   4) IndexedDB 原图库 factory_erp_images/full_images（key 同缩略图键名）
//   5) 图片空间绑定表 prodImgUrl_<归属账号>（换电脑后本机库为空，靠云端地址还原）
import { getFullImage, getLegacyImage } from './imageStore';
import { absoluteImageUrl, isRenderableImageValue, loadImageUrlMap } from './imageSpace';
import { recompressDataUrl } from './imageCompress';

/**
 * 「地址形似但根本加载不出来」的图片登记表（防盗链外链 / 404 / 脏数据）。
 * 只记地址不改数据：一旦某个地址探测失败，读取侧就当成无图处理（不嵌入卡片、
 * 不算「有图才自动上架」的资格），卡片也不会再挂破图。带 7 天 TTL 跨页面保留，
 * 避免每次打开市场都重新探测一批死链。
 */
const UNLOADABLE_CACHE_KEY = 'img_unloadable_cache_v1';
const UNLOADABLE_TTL_MS = 7 * 24 * 3600 * 1000;
const unloadable = new Set<string>();
let unloadableLoaded = false;

const loadUnloadableCache = (): void => {
  if (unloadableLoaded) return;
  unloadableLoaded = true;
  try {
    const map = JSON.parse(localStorage.getItem(UNLOADABLE_CACHE_KEY) || '{}');
    const now = Date.now();
    Object.keys(map).forEach((u: string) => {
      const ts = Number(map[u]) || 0;
      if (ts && now - ts < UNLOADABLE_TTL_MS) unloadable.add(u);
    });
  } catch { /* ignore */ }
};

const saveUnloadableCache = (url: string): void => {
  try {
    loadUnloadableCache();
    const map: Record<string, number> = {};
    unloadable.forEach(u => { map[u] = Date.now(); });
    localStorage.setItem(UNLOADABLE_CACHE_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
  void url;
};

/** 登记一个确认加载不了的图片地址（按绝对形态存） */
export const markImageUnloadable = (src: string): void => {
  const v = String(src || '').trim();
  if (!v) return;
  loadUnloadableCache();
  if (unloadable.has(v)) return;
  unloadable.add(v);
  saveUnloadableCache(v);
};

/** 该地址是否已被探测为加载不了（未探测过不算，以免误杀好图） */
export const isImageUnloadable = (src: string): boolean => {
  const v = String(src || '').trim();
  if (!v) return false;
  loadUnloadableCache();
  return unloadable.has(v);
};

/**
 * 探测图片地址能不能真加载出来（外链防盗链、404、脏数据都会失败）。
 * 探测本身不登记判死：批量场景下「一堆地址同时失败」更可能是断网或服务未就绪，
 * 由调用方（市场预扫描）按熔断规则决定是否登记，避免一次网络抖动把商品当无图下架。
 * data:/blob: 直接算可加载；非浏览器环境不判定失败（无资源加载能力，误报会把好图当无图）。
 */
export const probeImageLoadable = (src: string, timeoutMs = 8000): Promise<boolean> => new Promise(resolve => {
  const v = String(src || '').trim();
  if (!v || !isRenderableImageValue(v)) return resolve(false);
  if (isImageUnloadable(v)) return resolve(false);
  if (/^(data:image|blob:)/i.test(v)) return resolve(true);
  if (typeof window === 'undefined' || typeof window.Image !== 'function' || typeof document === 'undefined') return resolve(true);
  let done = false;
  let timer: any = null;
  const finish = (ok: boolean) => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    resolve(ok);
  };
  const img = new window.Image();
  // 超时不算失败也不登记：慢速网络下 onerror 往往不会来，误登记代价比漏判大
  timer = setTimeout(() => finish(true), timeoutMs);
  img.onload = () => finish(true);
  img.onerror = () => finish(false);
  img.src = v;
});

/** 批量探测（限并发）：返回可加载数量与失败地址清单，是否登记判死由调用方决定 */
export const probeImagesLoadable = async (urls: string[], concurrency = 6): Promise<{ alive: number; dead: string[] }> => {
  const list: string[] = [];
  const seen = new Set<string>();
  (urls || []).forEach(u => { const v = String(u || '').trim(); if (v && !seen.has(v)) { seen.add(v); list.push(v); } });
  let cursor = 0;
  let alive = 0;
  const dead: string[] = [];
  const pool = Math.max(1, Math.min(concurrency, list.length));
  const workers: Promise<void>[] = [];
  for (let i = 0; i < pool; i++) {
    workers.push((async () => {
      while (cursor < list.length) {
        const idx = cursor++;
        if (await probeImageLoadable(list[idx])) alive++;
        else dead.push(list[idx]);
      }
    })());
  }
  await Promise.all(workers);
  return { alive, dead };
};

/** 缩略图/原图共用的存储键（归属账号口径统一走 getDataOwner，不能用登录名——子账号会取错前缀） */
export const productImgKeyOf = (owner: string, productKey: string): string => `prodImg_${owner}_${productKey}`;

/** 同步通道：只查记录 image 字段与 localStorage 缩略图，拿不到返回空串（IndexedDB 图片查不到属正常）。
 * 记录自带地址必须是「可显示形态」且没被探测判死，否则继续往下找本机缩略图 */
export const productImgSync = (owner: string, productKey: string, recordImage?: string): string => {
  const raw = String(recordImage || '').trim();
  if (raw && isRenderableImageValue(raw)) {
    const cloud = absoluteImageUrl(raw);
    if (cloud && !isImageUnloadable(cloud)) return cloud;
  }
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
    // 绑定表里的云端地址也可能已经探测确认加载不了（二进制被清理/迁移丢失），不能当成有图
    if (url && !isImageUnloadable(url)) return url;
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
