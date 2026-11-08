/**
 * 统一图片压缩工具
 * 规则：最长边缩至 1600px；小于 100KB 的小图原样保留；
 * PNG 先检测透明像素——全不透明转 JPEG（截图/照片/单据类可省一个数量级空间），含透明仍保留 PNG；
 * 压缩结果若反而更大则回退原图，在节省空间与显示效果间取平衡；
 * 仍超出体积上限时逐级降质，避免单张图片吃满 localStorage 配额（base64 落盘按 UTF-16 双字节计）。
 */
export const COMPRESS_SKIP_BYTES = 100 * 1024;
export const COMPRESS_MAX_EDGE = 1600;
export const COMPRESS_QUALITY = 0.85;
/** 单张图压缩后的最大 base64 字符数（约 600KB 原始字节） */
export const COMPRESS_MAX_CHARS = 800000;

export interface CompressImageOptions {
  /** 最长边像素，默认 1600 */
  maxEdge?: number;
  /** JPEG 初始质量，默认 0.85 */
  quality?: number;
  /** 压缩后的 base64 字符数上限，超出则逐级降质，默认 800000 */
  maxChars?: number;
  /** 强制 JPEG（单据/照片类无透明需求；透明区域自动铺白底），默认按 PNG 透明像素自动判断 */
  forceJpeg?: boolean;
}

/** 采样检测 canvas 是否含透明像素（约 16 万采样点，兼顾准确与性能） */
const hasTransparentPixel = (ctx: CanvasRenderingContext2D, w: number, h: number): boolean => {
  try {
    const { data } = ctx.getImageData(0, 0, w, h);
    const step = Math.max(1, Math.round(Math.sqrt((w * h) / 160000)));
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (data[(y * w + x) * 4 + 3] < 250) return true;
      }
    }
    return false;
  } catch {
    // 读不到像素（如画布被污染）时按含透明处理，保持 PNG 更安全
    return true;
  }
};

/** 在已有像素下方铺白底：JPEG 无 alpha 通道，透明区域否则会被合成为黑色 */
const fillOpaqueWhite = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
};

/** 逐级降质直到不超过字符数上限（JPEG 才有效，PNG 已无更优解） */
const encodeJpegWithin = (canvas: HTMLCanvasElement, quality: number, maxChars: number): string => {
  let q = quality;
  let out = canvas.toDataURL('image/jpeg', q);
  while (out.length > maxChars && q > 0.45) {
    q = Math.round((q - 0.1) * 100) / 100;
    out = canvas.toDataURL('image/jpeg', q);
  }
  return out;
};

/** 读取并压缩图片，返回 base64 dataURL（压缩仅在上传时执行一次） */
export const compressImageFile = (file: File | Blob, options?: CompressImageOptions): Promise<string> =>
  new Promise((resolve, reject) => {
    const maxEdge = options?.maxEdge ?? COMPRESS_MAX_EDGE;
    const quality = options?.quality ?? COMPRESS_QUALITY;
    const maxChars = options?.maxChars ?? COMPRESS_MAX_CHARS;
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target?.result as string;
      if (!raw) { reject(new Error('图片读取失败')); return; }
      // 小图不压缩，避免无谓的清晰度损失
      if ((file.size || 0) <= COMPRESS_SKIP_BYTES) { resolve(raw); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(raw); return; }
          ctx.drawImage(img, 0, 0, w, h);
          // PNG 源：确含透明像素才保留 PNG，否则转 JPEG（canvas 重编码 PNG 往往比原截图还大，等于没压缩）
          const isPng = (file.type || '') === 'image/png' || raw.startsWith('data:image/png');
          const keepPng = isPng && !options?.forceJpeg && hasTransparentPixel(ctx, w, h);
          let out: string;
          if (keepPng) {
            out = canvas.toDataURL('image/png');
          } else {
            fillOpaqueWhite(ctx, w, h);
            out = encodeJpegWithin(canvas, quality, maxChars);
          }
          resolve(out.length < raw.length ? out : raw);
        } catch {
          resolve(raw);
        }
      };
      img.onerror = () => resolve(raw);
      img.src = raw;
    };
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });

/** 单条 dataURL 视为超大的阈值（字符数）：超过即需再压缩，防模版/证书副本膨胀撑爆存储配额 */
export const OVERSIZE_DATAURL_CHARS = 1500000;

/** 再压缩已落库的 dataURL（历史未压缩大图修复用）：不透明底场景铺白底转 JPEG，大幅缩减体积 */
export const recompressDataUrl = (
  dataUrl: string,
  maxEdge = COMPRESS_MAX_EDGE,
  quality = COMPRESS_QUALITY,
  maxChars = COMPRESS_MAX_CHARS,
): Promise<string> =>
  new Promise(resolve => {
    if (!dataUrl || !dataUrl.startsWith('data:image')) { resolve(dataUrl); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(dataUrl); return; }
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const out = encodeJpegWithin(canvas, quality, maxChars);
        resolve(out.length < dataUrl.length ? out : dataUrl);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
