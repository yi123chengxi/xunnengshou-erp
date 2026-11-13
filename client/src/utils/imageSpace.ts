/**
 * 图片空间（云端图片库）客户端 SDK
 *
 * 约定：
 * - 图片二进制存服务端，返回的 url 形如 /uploads/images/<账号目录>/<id>.jpg；
 *   渲染时用 absoluteImageUrl 补全为可跨域访问的绝对地址；
 * - 元信息走 /api/images（需登录令牌），列表/详情/引用位置都从服务端读取，
 *   所以换电脑、换浏览器看到的都是同一份图片清单；
 * - 业务页面「使用」一张图片时调用 registerImageRef 登记引用位置，
 *   图片空间详情页据此展示「被引用在哪些地方」。
 */
import { API_BASE, API_ORIGIN } from './apiBase';
import { tryCacheDataset } from './storageQuota';
import { saveDataset, loadDataset } from './dataStore';
import { flushDatasetUploadAsync } from './serverSync';

export interface ImageRef {
  key: string;
  module: string;
  moduleLabel: string;
  childKey: string;
  childLabel: string;
  recordKey: string;
  recordName: string;
  field: string;
  at: number;
}

export interface ImageAsset {
  id: string;
  name: string;
  url: string;
  thumbUrl: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  tags: string[];
  owner: string;
  uploader: string;
  createdAt: number;
  updatedAt: number;
  refCount?: number;
  refs?: ImageRef[];
}

export interface ImageRefInput {
  module: string;
  moduleLabel?: string;
  childKey?: string;
  childLabel?: string;
  recordKey: string;
  recordName?: string;
  field?: string;
}

export interface PreparedImage {
  dataUrl: string;
  thumbDataUrl: string;
  width: number;
  height: number;
  /** 原始文件字节数（仅用于展示，可缺省） */
  size?: number;
}

function authHeaders(): Record<string, string> {
  const token = (() => { try { return localStorage.getItem('token') || ''; } catch { return ''; } })();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 60000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}/images${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(init.headers || {}),
      },
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok || (body && body.code && body.code !== 0)) {
      const err: any = new Error(body?.message || `图片服务异常(${res.status})`);
      err.status = res.status;
      err.data = body?.data;
      throw err;
    }
    return (body?.data !== undefined ? body.data : body) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** 相对地址补全为绝对地址；data:/http(s): 原样返回 */
export function absoluteImageUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (/^(data:|blob:|https?:)/i.test(url)) return url;
  return `${API_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** 是否为本机旧版图片（base64 / 本地键名），用于兼容历史数据渲染 */
export function isLocalImageRef(value: string | undefined | null): boolean {
  if (!value) return false;
  return value.startsWith('data:') || value.startsWith('prodImg_') || value.startsWith('thumb_') ||
    value.startsWith('payShot_') || value.startsWith('mold_img_');
}

/** 图片链接 / 引用位置跳转地址 */
export function imageRefLink(ref: ImageRef): string {
  const base = `/${ref.module}${ref.childKey ? `/${ref.childKey}` : ''}`;
  return ref.recordKey ? `${base}?record=${encodeURIComponent(ref.recordKey)}` : base;
}

// ============ 图片预处理（压缩 + 缩略图，纯前端 canvas，无新增依赖） ============

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败'));
    img.src = dataUrl;
  });
}

function drawToJpeg(img: HTMLImageElement, maxSide: number, quality: number): string {
  let { width, height } = img;
  if (width > maxSide || height > maxSide) {
    if (width >= height) { height = Math.round((height * maxSide) / width); width = maxSide; }
    else { width = Math.round((width * maxSide) / height); height = maxSide; }
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  // 透明 PNG 转 JPEG 时铺白底，避免变成黑底
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/** 文件 → 原图(dataUrl，最长边 1600 + JPEG 0.86) + 缩略图(320 + 0.72) */
export async function prepareImageFile(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');
  if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20MB');
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
  const img = await loadImage(raw);
  const dataUrl = drawToJpeg(img, 1600, 0.86);
  const thumbDataUrl = drawToJpeg(img, 320, 0.72);
  return { dataUrl, thumbDataUrl, width: img.naturalWidth, height: img.naturalHeight, size: file.size };
}

/** 已有 base64（历史图片迁移用）→ 原图 + 缩略图 */
export async function prepareImageDataUrl(raw: string): Promise<PreparedImage> {
  const img = await loadImage(raw);
  const dataUrl = drawToJpeg(img, 1600, 0.86);
  const thumbDataUrl = drawToJpeg(img, 320, 0.72);
  return { dataUrl, thumbDataUrl, width: img.naturalWidth, height: img.naturalHeight, size: raw.length };
}

/**
 * 业务图片键 → 云端 URL 绑定表（prodImgUrl_<账号>）。
 * BOM/款式规格图等图片的存储 key 是货品 key，业务记录里没有图片字段；
 * 上传图片空间后把 url 记在这张表里随数据集同步，其他电脑据此把本地图片键还原成云端图。
 */
export const imageUrlMapKey = (owner: string): string => `prodImgUrl_${owner}`;

// 内存缓存：BOM/款式图单元格在渲染期逐行调用 cloudImageOf → loadImageUrlMap，
// 每次 JSON.parse 整张表会随商品数线性变慢，这里按账号缓存解析结果
const memUrlMaps = new Map<string, Record<string, string>>();

function readLocalUrlMap(owner: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(imageUrlMapKey(owner));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : null;
  } catch { return null; }
}

export function loadImageUrlMap(owner: string): Record<string, string> {
  if (!owner) return {};
  const hit = memUrlMaps.get(owner);
  if (hit) return hit;
  const fromLocal = readLocalUrlMap(owner);
  if (fromLocal) { memUrlMaps.set(owner, fromLocal); return fromLocal; }
  return {};
}

/**
 * 写绑定表：一次序列化、三通道落地
 * - IndexedDB：可信副本（localStorage 被配额清理删掉后仍能恢复）
 * - localStorage：尽力缓存（用 tryCacheDataset，不触发 emergencyFreeSpace 误删其他模块）
 * - 服务端 + 断网队列：写入钩子随缓存写入触发；缓存写不进时显式直传，保证换电脑可见
 */
function writeUrlMap(owner: string, map: Record<string, string>): void {
  const key = imageUrlMapKey(owner);
  memUrlMaps.set(owner, map);
  const json = Object.keys(map).length === 0 ? '{}' : JSON.stringify(map);
  // 空表（用户删掉最后一张）也要清掉本地并同步到服务端，否则旧地址会在下次拉取时复活
  if (Object.keys(map).length === 0) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    saveDataset(key, json);
    flushDatasetUploadAsync(key, json).catch(() => false);
    return;
  }
  const cached = tryCacheDataset(key, json);
  saveDataset(key, json);
  if (!cached) flushDatasetUploadAsync(key, json).catch(() => false);
}

/**
 * 批量登记图片键→云端 URL：整批只读一次、写一次。
 * 批量上传/复制商品时原先每条都重写整张表，500 条就是 500 次全表序列化，
 * 且每次都单独触发一轮配额清理，这里合并成一次。
 */
export function bindImageUrls(owner: string, entries: Record<string, string>, removed?: string[]): void {
  if (!owner) return;
  const base = loadImageUrlMap(owner);
  const next: Record<string, string> = { ...base };
  let changed = false;
  Object.keys(entries || {}).forEach((k) => {
    const url = entries[k];
    if (!k || !url || next[k] === url) return;
    next[k] = url;
    changed = true;
  });
  (removed || []).forEach((k) => {
    if (k && k in next) { delete next[k]; changed = true; }
  });
  if (!changed) return;
  writeUrlMap(owner, next);
}

/** 登记图片键→云端 URL；写入会触发同步上传，其他电脑随即可见 */
export function bindImageUrl(owner: string, key: string, url: string): void {
  if (!owner || !key || !url) return;
  bindImageUrls(owner, { [key]: url });
}

/** 解除图片键绑定（删除/替换图片时调用） */
export function unbindImageUrl(owner: string, key: string): void {
  if (!owner || !key) return;
  bindImageUrls(owner, {}, [key]);
}

/**
 * 启动预热：localStorage 里没有这张表（被配额清理删掉/换设备首次进入）时，
 * 用 IndexedDB 副本回灌内存缓存，否则本机 BOM/款式图会取不到云端地址而空着。
 */
export async function hydrateImageUrlMap(owner: string): Promise<number> {
  if (!owner) return 0;
  if (readLocalUrlMap(owner)) return 0; // 本地已有，按需惰性解析即可
  try {
    const rec = await loadDataset(imageUrlMapKey(owner));
    if (!rec || typeof rec.json !== 'string') return 0;
    const parsed = JSON.parse(rec.json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 0;
    const map = parsed as Record<string, string>;
    const size = Object.keys(map).length;
    if (size === 0) return 0;
    memUrlMaps.set(owner, map);
    tryCacheDataset(imageUrlMapKey(owner), rec.json);
    return size;
  } catch { return 0; }
}

// ============ API ============

export async function listImages(params: { scope?: 'mine' | 'all'; q?: string; tag?: string; limit?: number; offset?: number } = {}): Promise<{ total: number; items: ImageAsset[] }> {
  const qs = new URLSearchParams();
  if (params.scope === 'all') qs.set('scope', 'all');
  if (params.q) qs.set('q', params.q);
  if (params.tag) qs.set('tag', params.tag);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.offset) qs.set('offset', String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return call<{ total: number; items: ImageAsset[] }>(`/${suffix}`);
}

export async function getImageDetail(id: string): Promise<ImageAsset> {
  return call<ImageAsset>(`/${encodeURIComponent(id)}`);
}

export async function uploadImage(input: PreparedImage & { name?: string; tags?: string[]; ref?: ImageRefInput }): Promise<ImageAsset> {
  return call<ImageAsset>('/', {
    method: 'POST',
    body: JSON.stringify({
      dataUrl: input.dataUrl,
      thumbDataUrl: input.thumbDataUrl,
      name: input.name,
      tags: input.tags,
      width: input.width,
      height: input.height,
      ref: input.ref ? toRefPayload(input.ref) : undefined,
    }),
  }, 120000);
}

export async function updateImage(id: string, patch: { name?: string; tags?: string[] }): Promise<ImageAsset> {
  return call<ImageAsset>(`/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function deleteImage(id: string, force = false): Promise<void> {
  await call(`/${encodeURIComponent(id)}${force ? '?force=1' : ''}`, { method: 'DELETE' });
}

export async function listImageTags(): Promise<Array<{ tag: string; count: number }>> {
  return call<Array<{ tag: string; count: number }>>('/tags');
}

function toRefPayload(ref: ImageRefInput): any {
  return {
    module: ref.module,
    moduleLabel: ref.moduleLabel || '',
    childKey: ref.childKey || '',
    childLabel: ref.childLabel || '',
    recordKey: ref.recordKey,
    recordName: ref.recordName || '',
    field: ref.field || 'image',
  };
}

/** 登记引用位置（失败静默：不影响业务操作本身） */
export async function registerImageRef(imageId: string, ref: ImageRefInput): Promise<boolean> {
  if (!imageId) return false;
  try {
    await call(`/${encodeURIComponent(imageId)}/refs`, { method: 'POST', body: JSON.stringify({ ref: toRefPayload(ref) }) });
    return true;
  } catch { return false; }
}

/** 解除引用位置（失败静默） */
export async function unregisterImageRef(imageId: string, ref: ImageRefInput): Promise<boolean> {
  if (!imageId) return false;
  try {
    await call(`/${encodeURIComponent(imageId)}/refs`, { method: 'DELETE', body: JSON.stringify({ ref: toRefPayload(ref) }) });
    return true;
  } catch { return false; }
}

/** 按 id 批量解析图片（业务页面渲染用） */
export async function lookupImages(ids: string[]): Promise<Record<string, ImageAsset>> {
  const list = ids.filter(Boolean);
  if (list.length === 0) return {};
  return call<Record<string, ImageAsset>>(`/lookup?ids=${encodeURIComponent(list.join(','))}`);
}

// ============ 便捷：文件直传 + 引用登记 ============

export async function uploadImageFile(file: File, opts: { name?: string; tags?: string[]; ref?: ImageRefInput } = {}): Promise<ImageAsset> {
  const prepared = await prepareImageFile(file);
  return uploadImage({
    ...prepared,
    name: opts.name || file.name || '未命名图片',
    tags: opts.tags,
    ref: opts.ref,
  });
}

/**
 * 业务页面通用：把「替换某条记录的图片」落到图片空间。
 * 返回可直接写进记录里的 url / imageId；失败抛错由调用方降级到本地存储。
 */
export async function attachImageToRecord(file: File | string, opts: {
  name?: string;
  tags?: string[];
  module: string;
  moduleLabel?: string;
  childKey?: string;
  childLabel?: string;
  recordKey: string;
  recordName?: string;
  field?: string;
}): Promise<{ imageId: string; url: string; thumbUrl: string; asset: ImageAsset }> {
  const prepared = typeof file === 'string' ? await prepareImageDataUrl(file) : await prepareImageFile(file);
  const ref: ImageRefInput = {
    module: opts.module,
    moduleLabel: opts.moduleLabel,
    childKey: opts.childKey,
    childLabel: opts.childLabel,
    recordKey: opts.recordKey,
    recordName: opts.recordName,
    field: opts.field || 'image',
  };
  const asset = await uploadImage({
    ...prepared,
    name: opts.name || opts.recordName || '未命名图片',
    tags: opts.tags,
    ref,
  });
  return { imageId: asset.id, url: asset.url, thumbUrl: asset.thumbUrl, asset };
}
