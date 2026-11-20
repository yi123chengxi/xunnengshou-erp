/**
 * resolveImageValue 回归：业务记录里的图片字段值必须先归一成可渲染地址。
 * 模具租/售发布弹窗的历史缺陷即在于此——图片空间返回的是相对地址
 * `/uploads/images/<账号>/<id>.jpg`，被当成页面静态资源直接塞进 <img src> 就是破图，
 * 被当成 localStorage 键去取则会让整条记录的展示图被静默清空。
 */
import { resolveImageValue } from '../imageSpace';

describe('resolveImageValue', () => {
  it('相对云端地址改写到同源图片通道（不再落到页面自身的 /uploads 路径）', () => {
    const out = resolveImageValue('/uploads/images/u_1234abcd/img_x.jpg');
    expect(out).toContain('/api/images/file/u_1234abcd/img_x');
    expect(out).not.toContain('/uploads/');
    expect(out).not.toContain('.jpg');
  });

  it('绝对云端地址（含换服务器前的 http+IP 形态）同样改写回当前同源通道', () => {
    const out = resolveImageValue('http://120.27.143.175/uploads/images/u_7/img_m.jpg');
    expect(out).toContain('/api/images/file/u_7/img_m');
    expect(out).not.toContain('120.27.143.175');
  });

  it('data:/blob: 原样返回，不能被当成引用键去回源', () => {
    expect(resolveImageValue('data:image/jpeg;base64,AAA')).toBe('data:image/jpeg;base64,AAA');
    expect(resolveImageValue('blob:http://x/1')).toBe('blob:http://x/1');
  });

  it('本机引用键走传入的读取方式回源，取不到返回空串（由调用方过滤成无图而非破图）', () => {
    const read = (k: string) => (k === 'mold_img_ML-1_0' ? 'data:image/jpeg;base64,BBB' : '');
    expect(resolveImageValue('mold_img_ML-1_0', read)).toBe('data:image/jpeg;base64,BBB');
    expect(resolveImageValue('mold_img_ML-1_9', read)).toBe('');
  });

  it('空值返回空串', () => {
    expect(resolveImageValue('')).toBe('');
    expect(resolveImageValue(null)).toBe('');
    expect(resolveImageValue(undefined)).toBe('');
  });
});
