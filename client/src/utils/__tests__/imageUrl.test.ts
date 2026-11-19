/**
 * absoluteImageUrl 二进制同源通道改写回归：
 * 生产域名站点由面板维护、可能缺 /uploads 静态别名，图片二进制必须统一
 * 改写到 /api/images/file/* 由 node 同源直出，否则线上图片全 404。
 */
import { absoluteImageUrl } from '../imageSpace';

describe('absoluteImageUrl', () => {
  it('把 /uploads/images/ 前缀改写到 /api/images/file/ 同源通道（去扩展名防 vhost 正则劫持）', () => {
    const out = absoluteImageUrl('/uploads/images/u_1234abcd/img_x.jpg');
    expect(out).toContain('/api/images/file/u_1234abcd/img_x');
    expect(out).not.toContain('/uploads/');
    expect(out).not.toContain('.jpg');
  });

  it('同源绝对地址（含带扩展名的历史存储形态）剥 origin 后改写回同源通道', () => {
    const out = absoluteImageUrl('http://localhost:3000/uploads/images/u_1234abcd/img_x.jpg');
    expect(out).toContain('/api/images/file/u_1234abcd/img_x');
    expect(out).not.toContain('.jpg');
    const out2 = absoluteImageUrl('http://localhost:3000/api/images/file/u_1234abcd/img_x.jpg');
    expect(out2).toContain('/api/images/file/u_1234abcd/img_x');
    expect(out2).not.toContain('.jpg');
  });

  it('跨域绝对地址原样返回', () => {
    expect(absoluteImageUrl('https://cdn.other.com/a.jpg')).toBe('https://cdn.other.com/a.jpg');
  });

  it('data:/blob:/http(s): 原样返回', () => {
    expect(absoluteImageUrl('data:image/png;base64,xxx')).toBe('data:image/png;base64,xxx');
    expect(absoluteImageUrl('blob:http://x/1')).toBe('blob:http://x/1');
    expect(absoluteImageUrl('https://cdn.x.com/a.png')).toBe('https://cdn.x.com/a.png');
  });

  it('空值返回空串', () => {
    expect(absoluteImageUrl('')).toBe('');
    expect(absoluteImageUrl(null)).toBe('');
    expect(absoluteImageUrl(undefined)).toBe('');
  });
});
