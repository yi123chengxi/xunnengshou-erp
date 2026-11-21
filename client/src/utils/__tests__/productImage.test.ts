/**
 * 产品图片「有没有图」判定回归：
 * 历史缺陷是 Excel 导入的图片列（旧系统文件名/失效外链）被原样当成图片地址——
 * absoluteImageUrl 会把任意非空文本拼成一个必然 404 的同源地址，于是成品市场
 * 把「根本显示不出图」的商品判成「有图」自动上架，卡片挂破图、列表图片列空白。
 * 现在读取侧统一要求：地址既是可显示形态，又没被探测判死，否则一律当无图。
 */
import { absoluteImageUrl, isRenderableImageValue } from '../imageSpace';
import {
  productImgKeyOf, productImgSync, isImageUnloadable, markImageUnloadable,
  probeImageLoadable, probeImagesLoadable,
} from '../productImage';

const THUMB = 'data:image/jpeg;base64,THUMBIMG';

describe('isRenderableImageValue 可显示形态判定', () => {
  it('旧系统导出的文件名与中文文本不算图片地址', () => {
    expect(isRenderableImageValue('2622-黑色-35-黑色-35')).toBe(false);
    expect(isRenderableImageValue('IMG_0032.jpg')).toBe(false);
    expect(isRenderableImageValue('见设计稿')).toBe(false);
  });

  it('data:/blob:/http(s)://协议相对/同源路径算图片地址', () => {
    expect(isRenderableImageValue('data:image/png;base64,AAA')).toBe(true);
    expect(isRenderableImageValue('blob:http://localhost/1')).toBe(true);
    expect(isRenderableImageValue('https://cdn.other.com/a.jpg')).toBe(true);
    expect(isRenderableImageValue('http://cdn.other.com/a.jpg')).toBe(true);
    expect(isRenderableImageValue('//cdn.other.com/a.jpg')).toBe(true);
    expect(isRenderableImageValue('/uploads/images/u_1/img_x.jpg')).toBe(true);
  });

  it('空值与纯空白不算图片地址', () => {
    expect(isRenderableImageValue('')).toBe(false);
    expect(isRenderableImageValue('   ')).toBe(false);
    expect(isRenderableImageValue(undefined)).toBe(false);
    expect(isRenderableImageValue(null)).toBe(false);
  });
});

describe('productImgSync 记录地址不可用时的回落', () => {
  it('记录图片是非法形态时不拼破图地址，回落到本机缩略图键', () => {
    const owner = 'acct_sync_1';
    localStorage.setItem(productImgKeyOf(owner, 'p1'), THUMB);
    expect(productImgSync(owner, 'p1', '2622-黑色-35-黑色-35')).toBe(THUMB);
  });

  it('非法形态且本机也没有缩略图时判为无图（返回空串）', () => {
    expect(productImgSync('acct_sync_2', 'p_none', 'IMG_0032.jpg')).toBe('');
  });

  it('合法云端地址优先于缩略图键返回', () => {
    const owner = 'acct_sync_3';
    localStorage.setItem(productImgKeyOf(owner, 'p1'), THUMB);
    expect(productImgSync(owner, 'p1', 'https://cdn.other.com/a.jpg')).toBe('https://cdn.other.com/a.jpg');
  });

  it('地址已被探测判死时改用缩略图键，不再返回同一个死地址', () => {
    const owner = 'acct_sync_4';
    const dead = 'https://cdn.other.com/dead_404.jpg';
    localStorage.setItem(productImgKeyOf(owner, 'p1'), THUMB);
    markImageUnloadable(dead);
    expect(productImgSync(owner, 'p1', dead)).toBe(THUMB);
  });

  it('被判死的地址在绑定表通道同样不算有图', () => {
    const dead = absoluteImageUrl('https://cdn.other.com/dead_bind.jpg');
    markImageUnloadable(dead);
    expect(isImageUnloadable('https://cdn.other.com/dead_bind.jpg')).toBe(true);
  });
});

describe('不可加载登记表', () => {
  it('未探测过的地址不算判死，避免误杀好图', () => {
    expect(isImageUnloadable('https://cdn.other.com/never_probed.jpg')).toBe(false);
  });

  it('空地址不参与判定', () => {
    expect(isImageUnloadable('')).toBe(false);
    expect(isImageUnloadable('  ')).toBe(false);
    markImageUnloadable('');
    expect(isImageUnloadable('')).toBe(false);
  });

  it('判死结果写入本地缓存键，跨页面刷新仍生效', () => {
    markImageUnloadable('https://cdn.other.com/cached_dead.jpg');
    const cache = JSON.parse(localStorage.getItem('img_unloadable_cache_v1') || '{}');
    expect(cache['https://cdn.other.com/cached_dead.jpg']).toBeGreaterThan(0);
  });
});

describe('probeImageLoadable 探测', () => {
  it('非可显示形态直接判不可加载，不发起资源请求', async () => {
    expect(await probeImageLoadable('2622-黑色-35')).toBe(false);
  });

  it('data: 地址直接算可加载', async () => {
    expect(await probeImageLoadable('data:image/png;base64,AAA')).toBe(true);
  });

  it('已登记判死的地址不再重复探测', async () => {
    const dead = 'https://cdn.other.com/pre_marked.jpg';
    markImageUnloadable(dead);
    expect(await probeImageLoadable(dead)).toBe(false);
  });

  it('批量探测去重后只算一次，并回传失败地址清单（不自行登记判死）', async () => {
    const urls = [
      'data:image/png;base64,A', 'data:image/png;base64,A', 'data:image/png;base64,B',
      '2622-黑色-35', '',
    ];
    const res = await probeImagesLoadable(urls);
    expect(res.alive).toBe(2);
    expect(res.dead).toEqual(['2622-黑色-35']);
    expect(isImageUnloadable('2622-黑色-35')).toBe(false);
  });
});
