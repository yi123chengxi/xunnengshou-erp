// 统一图片压缩工具：财务模块与新款进度等上传/粘贴入口共用
// 规则：最长边缩至 1600px、JPEG 质量 0.85（视觉无损级）；小于 100KB 的小图原样保留；
// 压缩结果若反而更大则回退原图，在节省空间与显示效果间取平衡；
// PNG 源保持 PNG 输出（JPEG 无 alpha 通道会丢失透明背景）
export const COMPRESS_SKIP_BYTES = 100 * 1024;
export const COMPRESS_MAX_EDGE = 1600;
export const COMPRESS_QUALITY = 0.85;

/** 读取并压缩图片，返回 base64 dataURL（压缩仅在上传时执行一次） */
export const compressImageFile = (file: File | Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target?.result as string;
      if (!raw) { reject(new Error('图片读取失败')); return; }
      // 小图不压缩，避免无谓的清晰度损失
      if ((file.size || 0) <= COMPRESS_SKIP_BYTES) { resolve(raw); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, COMPRESS_MAX_EDGE / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(raw); return; }
          // PNG（含透明通道）源保持 PNG 输出，避免转 JPEG 后透明底变黑/白底
          const isPng = (file.type || '') === 'image/png' || raw.startsWith('data:image/png');
          ctx.drawImage(img, 0, 0, w, h);
          const out = isPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', COMPRESS_QUALITY);
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
export const recompressDataUrl = (dataUrl: string, maxEdge = COMPRESS_MAX_EDGE, quality = COMPRESS_QUALITY): Promise<string> =>
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
        const out = canvas.toDataURL('image/jpeg', quality);
        resolve(out.length < dataUrl.length ? out : dataUrl);
      } catch {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
