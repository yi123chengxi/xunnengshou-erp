/**
 * 历史图片迁移：把「只存在于本机」的旧版图片搬进云端图片空间。
 *
 * 覆盖三类来源：
 * 1) 产品图：localStorage 缩略图键 prodImg_<owner>_<recordKey> + IndexedDB 原图；
 * 2) 付款截图/凭证：页面数据里内嵌的 data:image/* 字符串（订单、财审、采购推送、交易单等）；
 * 3) 模具图：mold_img_<listingKey>_<idx> 引用键（模具租售市场）。
 *
 * 迁移策略：上传成功后把记录里的图片替换为云端 URL（小字符串，能随数据集同步到其他电脑），
 * 同时登记引用位置；本机原图不删除，避免迁移出错时无法回头。
 */
import { getFullImage, listFullImageKeys } from './imageStore';
import { attachImageToRecord, isLocalImageRef } from './imageSpace';
import { safeSetItem } from './storageQuota';
import { flushDatasetUploadAsync } from './serverSync';

export interface LocalImageCandidate {
  /** 本机存储键或「数据集键#记录键#字段」 */
  storageKey: string;
  kind: 'product' | 'payment' | 'mold';
  label: string;
  size: number;
}

const getOwner = (): string => {
  try {
    if (localStorage.getItem('isSubAccount') === 'true') {
      return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
    }
    return localStorage.getItem('username') || '';
  } catch { return ''; }
};

const PRODUCT_DATASET = (owner: string) => `pageData_basic-data_product-list_${owner}`;
const MOLD_LISTINGS_KEY = 'market_mold_listings';
/** 可能内嵌付款截图/凭证的字段名 */
const IMAGE_FIELDS = ['payScreenshot', 'payShot', 'screenshot', 'voucher', 'payVoucher', 'attachment'];

function labelOfRecord(rec: any): string {
  return String(rec?.productCode || rec?.styleCode || rec?.orderNo || rec?.billNo || rec?.supplierName || rec?.name || rec?.key || '记录');
}

function readArray(key: string): any[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

/** 扫描本机尚未上云的图片（只统计 data: 与本地引用键，已迁移的 URL 不计入） */
export function scanLocalImages(): LocalImageCandidate[] {
  const owner = getOwner();
  const out: LocalImageCandidate[] = [];
  const seen = new Set<string>();

  // 1) 产品图（缩略图键）
  const prodPrefix = `prodImg_${owner}_`;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prodPrefix)) continue;
      const raw = localStorage.getItem(key) || '';
      if (!raw.startsWith('data:')) continue;
      const recordKey = key.slice(prodPrefix.length);
      const rec = readArray(PRODUCT_DATASET(owner))?.find((r: any) => String(r?.key) === recordKey);
      out.push({ storageKey: key, kind: 'product', label: `产品图 · ${rec ? labelOfRecord(rec) : recordKey}`, size: raw.length });
      seen.add(recordKey);
    }
  } catch { /* ignore */ }

  // 2) 付款截图/凭证（内嵌在页面数据集或全局交易单）
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('pageData_') || key === 'market_trade_orders' || key === 'purchaser_pushed_orders') keys.push(key);
    }
    for (const key of keys) {
      const list = readArray(key);
      if (!list) continue;
      list.forEach((rec: any) => {
        if (!rec || typeof rec !== 'object') return;
        IMAGE_FIELDS.forEach(field => {
          const val = rec[field];
          if (typeof val !== 'string' || !val.startsWith('data:image')) return;
          out.push({
            storageKey: `${key}#${String(rec.key || rec.id || '')}#${field}`,
            kind: 'payment',
            label: `付款截图 · ${labelOfRecord(rec)}`,
            size: val.length,
          });
        });
        if (Array.isArray(rec.payScreenshots)) {
          rec.payScreenshots.forEach((v: any, idx: number) => {
            if (typeof v !== 'string' || !v.startsWith('data:image')) return;
            out.push({
              storageKey: `${key}#${String(rec.key || rec.id || '')}#payScreenshots[${idx}]`,
              kind: 'payment',
              label: `付款截图 · ${labelOfRecord(rec)}`,
              size: v.length,
            });
          });
        }
      });
    }
  } catch { /* ignore */ }

  // 3) 模具租售市场图片
  try {
    const listings = readArray(MOLD_LISTINGS_KEY) || [];
    listings.forEach((l: any) => {
      if (!Array.isArray(l?.images)) return;
      l.images.forEach((ref: string, idx: number) => {
        if (typeof ref !== 'string') return;
        const raw = ref.startsWith('data:') ? ref : (() => { try { return localStorage.getItem(ref) || ''; } catch { return ''; } })();
        if (!raw.startsWith('data:image')) return;
        out.push({
          storageKey: `${MOLD_LISTINGS_KEY}#${String(l.key || '')}#${idx}`,
          kind: 'mold',
          label: `模具图 · ${String(l.title || l.key || '')}`,
          size: raw.length,
        });
      });
    });
  } catch { /* ignore */ }

  // 去重（同一 storageKey 只保留一条）
  const uniq = new Map<string, LocalImageCandidate>();
  out.forEach(c => { if (!uniq.has(c.storageKey)) uniq.set(c.storageKey, c); });
  return Array.from(uniq.values()).sort((a, b) => b.size - a.size);
}

/** 迁移进度回调：done=已处理张数，total=待处理张数 */
export type MigrateProgress = (done: number, total: number) => void;

/**
 * 执行迁移，返回成功上传张数。
 * 幂等：已迁移成 URL 的记录不会被再次扫描到；中断后重新点击会从剩余项继续。
 */
export async function migrateLocalImages(onProgress?: MigrateProgress): Promise<number> {
  const owner = getOwner();
  const total = scanLocalImages().length;
  let done = 0;
  let uploaded = 0;
  const tick = () => { done++; if (onProgress) onProgress(done, total); };

  // ============ 1) 产品图 ============
  try {
    const datasetKey = PRODUCT_DATASET(owner);
    const list = readArray(datasetKey);
    if (list && list.length > 0) {
      const byKey = new Map<string, any>();
      list.forEach((r: any) => { if (r && r.key) byKey.set(String(r.key), r); });
      const prodPrefix = `prodImg_${owner}_`;
      const lsKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prodPrefix)) lsKeys.push(key);
      }
      // localStorage 已无缩略图但 IndexedDB 仍有原图的，也一并迁移
      const idbKeys = await listFullImageKeys();
      idbKeys.forEach(k => { if (k.startsWith(prodPrefix) && !lsKeys.includes(k)) lsKeys.push(k); });

      let touched = false;
      for (const storageKey of lsKeys) {
        const recordKey = storageKey.slice(prodPrefix.length);
        const rec = byKey.get(recordKey);
        let raw = '';
        try { raw = localStorage.getItem(storageKey) || ''; } catch { /* ignore */ }
        if (!raw.startsWith('data:')) raw = (await getFullImage(storageKey)) || '';
        if (!raw.startsWith('data:')) continue;
        try {
          const asset = await attachImageToRecord(raw, {
            name: rec ? labelOfRecord(rec) : recordKey,
            tags: ['产品图'],
            module: 'basic-data', moduleLabel: '基础数据',
            childKey: 'product-list', childLabel: '全部商品',
            recordKey, recordName: rec ? labelOfRecord(rec) : recordKey,
            field: 'image',
          });
          if (rec) {
            rec.imageUrl = asset.url;
            rec.imageId = asset.imageId;
            // 主数据里不再保留 base64（体积大且已可由 URL 复原）
            if (typeof rec.image === 'string' && rec.image.startsWith('data:')) delete rec.image;
            touched = true;
          }
          uploaded++;
        } catch { /* 单张失败不中断整批 */ }
        tick();
      }
      if (touched) {
        const json = JSON.stringify(list);
        if (safeSetItem(datasetKey, json)) {
          safeSetItem(`${datasetKey}_ts`, String(Date.now()));
          await flushDatasetUploadAsync(datasetKey, json).catch(() => false);
        }
      }
    }
  } catch { /* ignore */ }

  // ============ 2) 付款截图/凭证 ============
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('pageData_') || key === 'market_trade_orders' || key === 'purchaser_pushed_orders') keys.push(key);
    }
    for (const storageKey of keys) {
      const list = readArray(storageKey);
      if (!list) continue;
      // pageData_<module>_<child>_<owner> → 引用归位到对应模块页
      const parts = storageKey.split('_');
      const module = storageKey.startsWith('pageData_') ? (parts[1] || 'sales') : 'market';
      const childKey = storageKey.startsWith('pageData_') ? (parts[2] || '') : 'orders';
      let touched = false;

      for (const rec of list) {
        if (!rec || typeof rec !== 'object') continue;
        const recordKey = String(rec.key || rec.id || '');
        if (!recordKey) continue;
        for (const field of IMAGE_FIELDS) {
          const val = rec[field];
          if (typeof val !== 'string' || !val.startsWith('data:image')) continue;
          try {
            const asset = await attachImageToRecord(val, {
              name: `${labelOfRecord(rec)}-${field}`,
              tags: ['付款截图'],
              module, moduleLabel: module === 'sales' ? '销售管理' : (module === 'market' ? '商机市场' : module),
              childKey, recordKey, recordName: labelOfRecord(rec), field,
            });
            rec[field] = asset.url;
            touched = true;
            uploaded++;
          } catch { /* ignore */ }
          tick();
        }
        if (Array.isArray(rec.payScreenshots)) {
          for (let idx = 0; idx < rec.payScreenshots.length; idx++) {
            const val = rec.payScreenshots[idx];
            if (typeof val !== 'string' || !val.startsWith('data:image')) continue;
            try {
              const asset = await attachImageToRecord(val, {
                name: `${labelOfRecord(rec)}-付款截图${idx + 1}`,
                tags: ['付款截图'],
                module, moduleLabel: module === 'sales' ? '销售管理' : (module === 'market' ? '商机市场' : module),
                childKey, recordKey, recordName: labelOfRecord(rec), field: `payScreenshots[${idx}]`,
              });
              rec.payScreenshots[idx] = asset.url;
              touched = true;
              uploaded++;
            } catch { /* ignore */ }
            tick();
          }
        }
      }

      if (touched) {
        const json = JSON.stringify(list);
        if (safeSetItem(storageKey, json)) {
          safeSetItem(`${storageKey}_ts`, String(Date.now()));
          await flushDatasetUploadAsync(storageKey, json).catch(() => false);
        }
      }
    }
  } catch { /* ignore */ }

  // ============ 3) 模具图 ============
  try {
    const listings = readArray(MOLD_LISTINGS_KEY);
    if (listings && listings.length > 0) {
      let touched = false;
      for (const l of listings) {
        if (!Array.isArray(l?.images)) continue;
        const next: string[] = [];
        for (let idx = 0; idx < l.images.length; idx++) {
          const ref = l.images[idx];
          if (typeof ref !== 'string') { next.push(''); continue; }
          if (!isLocalImageRef(ref)) { next.push(ref); continue; }
          let raw = ref.startsWith('data:') ? ref : '';
          if (!raw) { try { raw = localStorage.getItem(ref) || ''; } catch { raw = ''; } }
          if (!raw.startsWith('data:image')) { next.push(''); continue; }
          try {
            const asset = await attachImageToRecord(raw, {
              name: `${String(l.title || l.key || '模具')}-图${idx + 1}`,
              tags: ['模具图'],
              module: 'market', moduleLabel: '商机市场',
              childKey: 'mold', childLabel: '模具租售',
              recordKey: String(l.key || ''), recordName: String(l.title || l.key || ''), field: `images[${idx}]`,
            });
            next.push(asset.url);
            touched = true;
            uploaded++;
          } catch {
            next.push(ref);
          }
          tick();
        }
        l.images = next.filter(Boolean);
      }
      if (touched) {
        const json = JSON.stringify(listings);
        if (safeSetItem(MOLD_LISTINGS_KEY, json)) {
          await flushDatasetUploadAsync(MOLD_LISTINGS_KEY, json).catch(() => false);
        }
      }
    }
  } catch { /* ignore */ }

  return uploaded;
}
