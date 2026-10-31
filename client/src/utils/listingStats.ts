/**
 * 上架统计共享工具函数
 * 被 NewStyleProgressPage（新款列表）、DevGroupStatsPage（分组统计）、DevPaymentPages（运营统计）共用
 * 确保品牌匹配规则与统计口径在三处完全一致
 */

/**
 * 加载品牌台账中"是否专版"为"普通"的品牌集合
 * 数据源：brandauth_auth_brandledger_<owner> + brandauth_own_<owner>
 */
export function loadNonExclusiveBrands(owner: string): Set<string> {
  const set = new Set<string>();
  try {
    const authLedger: { brandName?: string; isExclusive?: string }[] = JSON.parse(localStorage.getItem(`brandauth_auth_brandledger_${owner}`) || '[]');
    const ownBrands: { brandName?: string; isExclusive?: string }[] = JSON.parse(localStorage.getItem(`brandauth_own_${owner}`) || '[]');
    [...authLedger, ...ownBrands].forEach(b => {
      if (b.brandName && b.isExclusive !== '是') set.add(b.brandName.trim());
    });
  } catch { /* ignore */ }
  return set;
}

/**
 * 品牌匹配判定（纯函数）
 * 规则：
 *   ① 货号品牌与店铺品牌 trim 后相等（含双方均空）
 *   ② 货号品牌为空 且 店铺品牌在台账中"是否专版"为"普通"（nonExclusiveBrands 包含）
 */
export function isBrandMatch(recBrand: string, shopBrand: string, nonExclusiveBrands: Set<string>): boolean {
  if (recBrand === shopBrand) return true;
  if (!recBrand && nonExclusiveBrands.has(shopBrand)) return true;
  return false;
}

/**
 * 上架统计结果
 */
export interface ListingStatsResult {
  /** 应上架数量（品牌匹配的 店铺×货号 对数） */
  shouldList: number;
  /** 已上架数量 */
  listedCount: number;
  /** 未上架数量 */
  notListed: number;
  /** 上架率（百分比，0-100） */
  listingRate: number;
}

/**
 * 计算上架统计指标
 *
 * @param shops - 该运营人员负责的店铺列表（含 shopName 和 brand）
 * @param progress - 新款进度主表单数据（含 styleCode 和 brand）
 * @param photos - 回传图片记录（含 styleCode 和 listingShops）
 * @param nonExclusiveBrands - 品牌台账中"普通"品牌集合
 *
 * 计算逻辑：
 *   1. 候选货号 = 回传记录（photos）中的 styleCode 去重集合
 *   2. 应上架 = 每个店铺 × 每个候选货号中品牌匹配的对数
 *   3. 已上架 = 应上架中，该货号 listingShops 包含该店铺名的数量
 *   4. 未上架 = 应上架 - 已上架
 *   5. 上架率 = 已上架 / 应上架 × 100
 */
export function calcListingStats(
  shops: { shopName: string; brand: string }[],
  progress: { styleCode: string; brand?: string }[],
  photos: { styleCode: string; listingShops?: string[] }[],
  nonExclusiveBrands: Set<string>,
): ListingStatsResult {
  let shouldList = 0;
  let listedCount = 0;

  // 候选货号：回传记录中实际存在的 styleCode（去重）
  const photoStyleCodes = Array.from(new Set(photos.map(ph => ph.styleCode).filter(Boolean)));

  shops.forEach(shop => {
    const shopBrand = (shop.brand || '').trim();
    photoStyleCodes.forEach(sc => {
      const prog = progress.find(p => p.styleCode === sc);
      const recBrand = (prog?.brand || '').trim();
      if (isBrandMatch(recBrand, shopBrand, nonExclusiveBrands)) {
        shouldList++;
        const photo = photos.find(ph => ph.styleCode === sc);
        if (photo && (photo.listingShops || []).includes(shop.shopName)) {
          listedCount++;
        }
      }
    });
  });

  const notListed = shouldList - listedCount;
  const listingRate = shouldList > 0 ? (listedCount / shouldList) * 100 : 0;

  return { shouldList, listedCount, notListed, listingRate };
}
