// 剪贴板读图兜底单测：锁定「http 非安全上下文下点粘贴按钮不再无解」这条修复不变量——
// 浏览器禁止脚本读剪切板时，readClipboardImage 必须弹出自动聚焦的粘贴捕获框，
// 用户在框内按一次 Ctrl+V（paste 事件）即取到图片；直接关闭才按 unsupported 引导。
import { readClipboardImage, clipboardImageFailureText } from '../clipboard';

const pngFile = () => new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });

/** 造一个带 clipboardData 的原生 paste 事件（jsdom 无 DataTransfer 构造器） */
const firePaste = (el: Element, file: File | null) => {
  const evt = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'clipboardData', {
    value: {
      items: file ? [{ kind: 'file', type: file.type, getAsFile: () => file }] : [],
      files: file ? [file] : [],
    },
  });
  el.dispatchEvent(evt);
};

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const findCaptureBox = (): Element | undefined =>
  Array.from(document.querySelectorAll('.ant-modal-body div[tabindex="0"]'))
    .find(d => (d.textContent || '').includes('Ctrl + V'));

describe('clipboard 读图兜底', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
  });
  afterEach(async () => {
    // 等 rc-motion 退场动画自行移除节点后再清残留，避免与 antd 内部 removeChild 撞车
    await wait(500);
    document.querySelectorAll('.ant-modal-root').forEach(n => n.remove());
  });

  it('非安全上下文下弹出粘贴捕获框，框内 Ctrl+V 取到图片', async () => {
    const promise = readClipboardImage();
    await wait(150);
    const box = findCaptureBox();
    expect(!!box).toBe(true);
    firePaste(box as Element, pngFile());
    const res = await promise;
    expect(res.ok).toBe(true);
  });

  it('捕获框内无图片的粘贴不接管（不影响文字粘贴语义）', async () => {
    const promise = readClipboardImage();
    await wait(150);
    const box = findCaptureBox();
    expect(!!box).toBe(true);
    firePaste(box as Element, null);
    // 未取到图：promise 仍 pending，关闭弹窗后才落 unsupported
    const okBtn = Array.from(document.querySelectorAll('button'))
      .find(b => (b.textContent || '').replace(/\s/g, '') === '关闭');
    expect(!!okBtn).toBe(true);
    (okBtn as HTMLButtonElement).click();
    const res = await promise;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(clipboardImageFailureText(res.reason)).toContain('Ctrl+V');
  });
});
