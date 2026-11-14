/**
 * 剪贴板复制（兼容 HTTP 等非安全上下文）：
 * 生产环境为 http://IP 部署，navigator.clipboard 在非安全上下文下为 undefined，
 * 直接调用 writeText 会抛错导致复制按钮"无效果"；此处优先 Clipboard API，
 * 不可用或失败时回退临时 textarea + document.execCommand('copy')。
 */
export const copyText = async (text: string): Promise<boolean> => {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* 安全上下文写入失败时继续走回退 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

/**
 * 剪贴板读图（粘贴图片用）：
 * 与 writeText 不同，read() 没有任何 execCommand 回退——非安全上下文下
 * navigator.clipboard 为 undefined，直接调用会同步抛 TypeError，连 catch 都只是
 * 统一变成"读不到"；因此这里把失败原因显式区分出来，由调用方引导用户改走
 * 元素级 paste 事件（clipboardData 不受安全上下文限制，是 http 部署下唯一可靠路径）。
 */
export type ClipboardImageFailure = 'unsupported' | 'denied' | 'empty' | 'error';
export type ClipboardImageResult = { ok: true; blob: Blob } | { ok: false; reason: ClipboardImageFailure };

/** 脚本能否读剪贴板：要求存在 read 且处于安全上下文（https / localhost） */
export const canReadClipboardImage = (): boolean => {
  try {
    return !!navigator.clipboard && typeof navigator.clipboard.read === 'function' && window.isSecureContext !== false;
  } catch {
    return false;
  }
};

/** 读剪贴板里的第一张图片（仅按钮点击路径；不可用时返回 unsupported 让调用方提示按 Ctrl+V） */
export const readClipboardImage = async (): Promise<ClipboardImageResult> => {
  if (!canReadClipboardImage()) return { ok: false, reason: 'unsupported' };
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = (item.types || []).find(t => String(t).startsWith('image/'));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      if (blob) return { ok: true, blob };
    }
    return { ok: false, reason: 'empty' };
  } catch (err: any) {
    const name = String(err?.name || '');
    return { ok: false, reason: name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error' };
  }
};

/** 从 clipboardData 取第一张图片文件：paste 事件路径，任何上下文都可用 */
export const imageFileFromClipboardData = (data: DataTransfer | null): File | null => {
  if (!data) return null;
  const items = data.items;
  if (items) {
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
  }
  for (const file of Array.from(data.files || [])) {
    if (String(file.type || '').startsWith('image/')) return file;
  }
  return null;
};

/** 元素级 onPaste 取图：React.ClipboardEvent 同样带 clipboardData，可直接传入 */
export const imageFileFromPasteEvent = (e: { clipboardData: DataTransfer | null }): File | null =>
  imageFileFromClipboardData(e.clipboardData || null);

/** 取图失败提示：一律把用户导向 http 下也有效的 Ctrl+V 路径，不再让"已截图却读不到"无解 */
export const clipboardImageFailureText = (reason: ClipboardImageFailure): string => {
  if (reason === 'empty') return '剪切板中没有图片，请重新截图后再试';
  if (reason === 'denied') return '剪切板读取被浏览器拒绝，请在图片区域直接按 Ctrl+V 粘贴，或点「上传」选择图片';
  if (reason === 'unsupported') return '当前以 http 访问，浏览器不允许页面读取剪切板，请在图片区域直接按 Ctrl+V 粘贴，或点「上传」选择图片';
  return '读取剪切板失败，请在图片区域直接按 Ctrl+V 粘贴，或点「上传」选择图片';
};
