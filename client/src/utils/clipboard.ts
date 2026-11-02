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
