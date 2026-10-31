/**
 * 品牌授权模块共享工具（授权品牌 / 自有品牌 / 外部申请 三处共用）
 * 数据均按租户隔离：键名后缀为 getDataOwner()（子账号归父账号）
 */

// ============ 租户归属 ============
export const getDataOwner = (): string => {
  try {
    const isSub = localStorage.getItem('isSubAccount') === 'true';
    if (isSub) return localStorage.getItem('parentAccount') || localStorage.getItem('username') || '';
    return localStorage.getItem('username') || '';
  } catch { return ''; }
};

// ============ 存储键 ============
export const baKeys = (owner: string) => ({
  records: `brandauth_records_${owner}`,   // 授权品牌登记表
  apps: `brandauth_apps_${owner}`,         // 外部代理商授权申请
  tpl: `brandauth_tpl_${owner}`,           // 授权书模版
  recv: `brandauth_recv_${owner}`,         // 品牌方收款账户（自有品牌页可改）
  pub: `brandauth_pub_${owner}`,           // 对外公开信息（公司名称+收款账户），供外部申请页读取
  own: `brandauth_own_${owner}`,           // 自有品牌台账（品牌名/商标号/类目）
});

export const safeJson = <T,>(k: string, d: T): T => {
  try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : (v as T); } catch { return d; }
};
export const writeJson = (k: string, v: any): void => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
};

// ============ 数据结构 ============
export interface BrandRecord {
  key: string;
  filler: string; brandName: string; authStatus: string; companyName: string;
  depositRefunded: string; salesperson: string; shopName: string; authWechat: string;
  phone: string; depositTo: string; remark: string; platform: string;
  laierShot: string; brandShot: string; otherRemark: string;
  license: string; idcard: string; guarantee: string; fillTime: string; image: string;
  shopType: string; transferred: string; creator?: string; deposit?: string;
  depositStatus?: '' | 'applied' | 'pending_confirm' | 'received' | 'returned';
  depositReceiptKey?: string;
  depositReturnImages?: string[];
  depositRemark?: string;
}

export interface BrandApplication {
  key: string;
  companyName: string; taxpayerCode: string; legalPerson: string; address: string;
  province?: string;               // 省（申请页选择项）
  city?: string;                   // 市
  district?: string;               // 区县
  phone: string; platform: string; platformUrl: string; deposit: string; payShot: string;
  businessLicense?: string;      // 营业执照图片
  idFront?: string;              // 身份证正面
  idBack?: string;               // 身份证反面
  agreementImage?: string;       // 代理商签署的协议书照片
  payBank?: string;                // 付款银行账户（选择或手输值串）
  payBankNo?: string;              // 匹配到的付款银行账号（记账联动用）
  personInCharge?: string;         // 负责人（邀请链接绑定或品牌方编辑登记，子账号姓名）
  rejectReason?: string;           // 驳回原因（状态=已驳回时）
  rejectAt?: string;               // 驳回时间
  archived?: boolean;              // 已归档（保证金已退回且授权到期后移入归档子页）
  archivedAt?: string;             // 归档时间
  recvSnapshot: string;          // 提交时展示给代理商的收款账户（留痕）
  status: '待确认' | '已确认到账' | '已生成授权书' | '授权书已发' | '续签成功' | '已驳回';
  appliedAt: string;
  appNo?: string;                // 申请编号 BA-yyyymmdd-流水
  authNo: string;                // 确认到账后生成
  confirmedAt: string;
  certImage?: string;            // 我方上传的授权书图片（盖章件）
  depositState?: '' | '已确认' | '已退回';   // 保证金状态
  recvBankKey?: string;            // 确认到账所选收款银行账户 key
  recvBankSnapshot?: string;       // 确认到账时收款账户留痕
  refundAgentRecv?: string;        // 退回时代理商收款账户（选填）
  refundPayBankName?: string;      // 退回时我方付款账户名
  refundShot?: string;             // 退回付款截图（回传代理商）
  refundAt?: string;
  certImageAt?: string;
  depositReceiptKey?: string;      // 关联的收款确认单 key (payment_requests)
  depositPaymentKey?: string;      // 退回时关联的付款申请 key (payment_requests)
  depositRejectReason?: string;    // 退回申请被驳回的原因
  depositRejectAt?: string;        // 退回驳回时间
  shareCode?: string;            // 公开查询凭证（随机）
  agentUsername?: string;        // 绑定的采购商账号（用于镜像到代理商后台）
  brandName: string; trademarkNo: string; category: string; shopName: string;
  shopId?: string;                 // 店铺ID（申请页填写，模版 {店铺ID}）
  shopType?: string;               // 店铺类型（企业店/专卖店/旗舰店，模版 {店铺类型}）
  validFrom: string; validTo: string;
  certHtml: string; certAt: string;
  remark: string;
}

export interface BrandTemplate {
  key?: string;                  // 模版键（多模版列表用，预设='tpl-preset'）
  name?: string;                 // 模版名称
  body: string;                  // 纯文本模版（旧版兼容）
  html?: string;                 // 富文本模版（Word 式排版，含内联样式与占位符 span）
  bgImage: string;               // 背景图 dataURL 或内置默认图 URL
  customFields: { key: string; label: string }[];
  style?: CertStyle;             // 页面级排版样式
  watermark?: WatermarkCfg;      // 背景水印配置
  updatedAt: string;
}

/** 授权书模版默认背景图（内置证书花边框图，随包发布于 public/；租户可删除或自行上传替换） */
export const DEFAULT_CERT_BG = '/auth-bg-default.png';

// ============ 授权书排版样式 ============
export interface CertStyle {
  fontFamily: string;   // 字体
  fontSize: number;     // 字号 px
  lineHeight: number;   // 行高（倍）
  letterSpacing: number;// 字间距 px
  indent: number;       // 首行缩进 em
  align: 'left' | 'center' | 'right' | 'justify';
  color: string;        // 文字颜色
  bold: boolean;        // 加粗
  padTop: number;       // 上内边距 px
  padBottom?: number;   // 下内边距 px（未设取 padTop）
  padSide: number;      // 左右内边距 px
  padLeft?: number;     // 左内边距 px（未设取 padSide）
  padRight?: number;    // 右内边距 px（未设取 padSide）
}
export const DEFAULT_CERT_STYLE: CertStyle = {
  fontFamily: 'SimSun, "Songti SC", serif',
  fontSize: 16, lineHeight: 2, letterSpacing: 1, indent: 2,
  align: 'left', color: '#1a1a1a', bold: false, padTop: 70, padSide: 90,
};
export const FONT_OPTIONS = [
  { value: 'SimSun, "Songti SC", serif', label: '宋体' },
  { value: 'SimHei, "Heiti SC", sans-serif', label: '黑体' },
  { value: 'KaiTi, "Kaiti SC", serif', label: '楷体' },
  { value: 'FangSong, "Fangsong SC", serif', label: '仿宋' },
  { value: '"Microsoft YaHei", sans-serif', label: '微软雅黑' },
];

// ============ 授权书背景水印 ============
export interface WatermarkCfg {
  enabled: boolean;   // 启用水印
  text: string;       // 水印文字（可含 {占位符}，生成时渲染）
  fontSize: number;   // 字号 px
  color: string;      // 颜色
  opacity: number;    // 透明度 0-1
  rotate: number;     // 旋转角度
}
export const DEFAULT_WATERMARK: WatermarkCfg = {
  enabled: false, text: '{公司名称} · {授权编号}', fontSize: 26, color: '#8c8c8c', opacity: 0.14, rotate: -45,
};
/** 水印层：45° 倾斜铺满整张、上下行错开不重叠、行间隔约 1cm；
 *  确定性网格布局，预览与生成结果一致 */
export const buildWatermarkHtml = (renderedText: string, cfg?: Partial<WatermarkCfg>): string => {
  const w: WatermarkCfg = { ...DEFAULT_WATERMARK, ...(cfg || {}) };
  if (!w.enabled || !String(renderedText || '').trim()) return '';
  const text = String(renderedText);
  // 估算文本宽度（CJK 全角≈1em，ASCII≈0.6em）→ 列步长保证不重叠
  const est = Array.from(text).reduce((a, ch) => a + (ch.charCodeAt(0) > 255 ? w.fontSize : w.fontSize * 0.6), 0);
  const colStep = Math.round(est + 60);
  // 行步长 = 字号 + 1cm(≈38px) 间隔
  const rowStep = Math.round(w.fontSize + 38);
  // 旋转平面放大覆盖整张纸（含旋转后角落）
  const planeW = Math.round(794 * 2.2);
  const planeH = Math.round(1200 * 2.2);
  const rows = Math.ceil(planeH / rowStep) + 1;
  const cols = Math.ceil(planeW / colStep) + 1;
  const cells: string[] = [];
  for (let r = 0; r < rows; r++) {
    const y = r * rowStep;
    const xOff = r % 2 === 1 ? Math.round(colStep / 2) : 0; // 奇数行错开半列，上下不对齐
    for (let c = 0; c < cols; c++) {
      const x = c * colStep + xOff;
      cells.push(`<span style="position:absolute;top:${y}px;left:${x}px;font-size:${w.fontSize}px;color:${w.color};opacity:${w.opacity};white-space:nowrap">${escapeHtml(text)}</span>`);
    }
  }
  return `<div style="position:absolute;top:0;left:0;right:0;bottom:0;overflow:hidden;pointer-events:none"><div style="position:absolute;left:-60%;top:-60%;width:220%;height:220%;transform:rotate(${w.rotate}deg)">${cells.join('')}</div></div>`;
};

export interface RecvAccount { accountName: string; bankName: string; branchName: string; bankAccountNo: string; note: string; }

/** 对外公开信息（公司名称 + 收款账户 + 自有品牌台账） */
export interface PubInfo {
  companyName: string;
  recv: RecvAccount;
  brands: { brandName: string; trademarkNo: string; category: string; signCompany?: string }[];
}

// ============ 枚举 ============
export const AUTH_STATUS_OPTS = ['授权已发', '已经提交给品牌方', '已退店'];
export const DEPOSIT_TO_OPTS = ['品牌方', '我方收', '没交保证金'];
export const SHOP_TYPE_OPTS = ['公司内部店铺', '分销商店铺'];

// ============ 占位符体系 ============
// 代理商提交字段
export const AGENT_FIELDS: { token: string; label: string }[] = [
  { token: '公司名称', label: '公司名称' },
  { token: '纳税人识别码', label: '纳税人识别码' },
  { token: '法人代表', label: '法人代表' },
  { token: '经营地址', label: '经营地址' },
  { token: '联系电话', label: '联系电话' },
  { token: '授权平台', label: '授权平台' },
  { token: '授权平台网址', label: '授权平台网址' },
  { token: '保证金', label: '保证金' },
  { token: '店铺类型', label: '店铺类型' },
  { token: '店铺ID', label: '店铺ID' },
];
// 店铺类型预设与差异化底色（企业店=蓝 / 专卖店=绿 / 旗舰店=金）
export const SHOP_TYPES = ['企业店', '专卖店', '旗舰店'];
export const SHOP_TYPE_COLOR: Record<string, { bg: string; color: string; border: string }> = {
  企业店: { bg: '#e6f4ff', color: '#0958d9', border: '#91caff' },
  专卖店: { bg: '#f6ffed', color: '#389e0d', border: '#b7eb8f' },
  旗舰店: { bg: '#fffbe6', color: '#d48806', border: '#ffe58f' },
};
export const shopTypeStyle = (t: string) => {
  const c = SHOP_TYPE_COLOR[t] || { bg: '#fafafa', color: '#666', border: '#d9d9d9' };
  return { display: 'inline-block', padding: '0 8px', borderRadius: 4, background: c.bg, color: c.color, border: `1px solid ${c.border}`, lineHeight: '20px' };
};
// 系统/自定义字段
export const SYSTEM_FIELDS: { token: string; label: string }[] = [
  { token: '授权编号', label: '授权编号' },
  { token: '品牌名称', label: '品牌名称' },
  { token: '商标号', label: '商标号' },
  { token: '类目', label: '类目' },
  { token: '店铺名称', label: '店铺名称' },
  { token: '有效期起', label: '有效期起' },
  { token: '有效期止', label: '有效期止' },
  { token: '落款公司', label: '落款公司' },
  { token: '落款日期', label: '落款日期' },
  // 协议书（线上专卖店销售保证书）专用字段
  { token: '品牌方公司', label: '品牌方公司' },
  { token: '授权方', label: '授权方' },
  { token: '信用代码', label: '信用代码' },
  { token: '店铺账号', label: '店铺账号' },
  { token: '年费', label: '年费' },
  { token: '联系人', label: '联系人' },
  { token: '授权日期', label: '授权日期' },
  { token: '注册商标号', label: '注册商标号' },
];

export const DEFAULT_TEMPLATE_BODY = `授权书

兹授权　{公司名称}　在{授权平台}开设{店铺名称}，使用注册商标第 {商标号} 号商标"{品牌名称}"，并许可销售第 {商标号} 号商标等商标 {类目} 类目产品。

该公司自负盈亏，{落款公司}对其不负任何债务和其他民事责任。

经营期间内，必须严格执行{落款公司}的法规和协议；如违反规定，视为自动放弃我公司授权，我公司也有权收回此授权。

授权编号：{授权编号}

有效期自：{有效期起} 至 {有效期止}

特此授权！

{落款公司}
{落款日期}`;

export const defaultTemplate = (): BrandTemplate => ({
  body: DEFAULT_TEMPLATE_BODY,
  bgImage: DEFAULT_CERT_BG,
  customFields: [],
  style: { ...DEFAULT_CERT_STYLE },
  updatedAt: '',
});

// ============ 协议书（线上专卖店销售保证书）预设模版 ============
const DEFAULT_AGREEMENT_HTML = [
  '<div style="text-align:center;font-size:22px;font-weight:bold;letter-spacing:2px">线上专卖店销售保证书</div>',
  '<div>兹 {品牌方公司} 为品牌：{品牌名称}（注册号：{注册商标号}），以下简称“授权品牌”的所有鞋类产品合法使用者。特授权 {授权方} ，统一社会信用代码/身份证号：{信用代码} 在如下范围内使用授权品牌：</div>',
  '<div>一、授权渠道：</div>',
  '<div>被授权方有权在 {授权平台} 电商平台，使用开设 {授权平台} 店铺，店铺名称：{店铺名称} ，店铺账号名/ID：{店铺ID} ，品牌使用范围包括店铺名称（具体以平台审核通过为准）、店铺 LOGO、宣传素材等，并有权开展授权品牌所有鞋类产品的销售、推广活动。</div>',
  '<div>二、权利和义务</div>',
  '<div>1、被授权方向授权方缴纳单店保证金 {保证金} 元，年费 {年费} 元，保证金在授权结束后，需全额退回被授权方。</div>',
  '<div>2、授权期间，被授权方不得仿制生产与授权品牌相同或相似的产品。未经授权方事先书面许可，不私自多开未授权店铺。被授权方不得将授权转让、分包、转委托或以其他方式转移给任何第三方。被授权方不得在店铺中销售授权品牌外的其他任何产品。一旦发现，授权方有权罚没保证金并依法追究相关法律责任。</div>',
  '<div>3、未经授权方事先书面许可，被授权方不得私自开设未授权店铺。本授权协议仅允许被授权方开设一家官方授权店铺。若被授权方违反本条款，私自多开店铺，则每多开一家店铺，需向授权方支付人民币 5 万元作为违约赔偿金。</div>',
  '<div>4、被授权方不得以任何方式（包括但不限于软件修改、人工篡改）对授权书及品牌资质文件进行任何形式的改动，包括但不限于：公章、印章信息；文字内容、标点符号；授权范围、期限等关键条款。如发现被授权方存在篡改行为，品牌方有权立即终止授权，并要求被授权方支付人民币 10 万元作为违约赔偿金，同时保留追究法律责任的权利。</div>',
  '<div>5、被授权方有责任维护品牌形象，必须符合统一或经批准的包装材料，正确悬挂品牌吊牌标识，按授权方的要求进行线上店铺装潢；授权方有权进行日常巡查抽检，如发现未按要求使用包装材料和品牌标识，可采取扣除保证金处罚，且授权方有权利撤回授权。</div>',
  '<div>6、授权合作到期后 3 个工作日内，被授权方将所有品牌相关的产品音视频资料、产品图片、图像资料等自行撤掉或删除，不得再使用任何品牌形象及产品资料。</div>',
  '<div>7、被授权方在销售产品时，必须严格遵守品牌方制定的价格规则，不得以任何形式（如优惠券、金币、红包、满减等）变相降低售价，使其低于品牌方规定的最低控价。首次违规：品牌方将发出书面警告，并要求被授权方在 3 个小时内整改完毕。二次违规：品牌方有权采取以下措施：立即终止授权合作；强制关闭违规店铺；罚没全部保证金；追究法律责任，并索赔人民币 5 万元违约金。</div>',
  '<div>8、被授权方所属代理商知晓并接受本协议全部条款，须对被授权方的违约行为承担连带责任。若被授权方违反本协议，授权方有权直接从代理商的押金中扣除相应违约金，并有权要求代理商补足未支付的赔偿。该责任不因被授权方与代理商之间的内部约定而免除，且持续至合作终止后 12 个月或债务清偿完毕为止。</div>',
  '<div>被授权方将自觉遵守{品牌方公司}制定的以上销售有关规定，自觉保护{品牌名称}品牌注册商标权和知识产品，坚决杜绝和打击仿冒、擅自制造等制假行为。</div>',
  '<div>被授权方（盖章+签字+指纹印）：＿＿＿＿＿＿＿＿　　所属代理商（盖章+签字+指纹印）：＿＿＿＿＿＿＿＿</div>',
  '<div>保 证 人（实际经营人+身份证复印件）：＿＿＿＿＿＿　保 证 人（实际经营人）：＿＿＿＿＿＿＿＿</div>',
  '<div>联 系 人：{联系人}　　　　　　　　　　　　　联 系 人：＿＿＿＿＿＿＿＿</div>',
  '<div>联系电话：{联系电话}　　　　　　　　　　　　联系电话：＿＿＿＿＿＿＿＿</div>',
  '<div>授权日期：{授权日期}　　　　　　　　　　　　授权日期：＿＿＿＿＿＿＿＿</div>',
].join('');

/** 协议书预设模版（与授权书模版同结构；在“授权模版编辑”窗口编辑，保存后发布到外部申请页供下载） */
export const defaultAgreementTemplate = (): BrandTemplate => ({
  body: '',
  html: DEFAULT_AGREEMENT_HTML,
  bgImage: '',
  customFields: [],
  style: { ...DEFAULT_CERT_STYLE },
  updatedAt: '',
});

// ============ 授权书渲染 ============
/** 将模版中的 {占位符} 替换为取值；未提供的占位符替换为空串 */
export const renderCert = (body: string, values: Record<string, string>): string =>
  String(body || '').replace(/\{([^{}]+)\}/g, (_m, tok: string) => {
    const t = String(tok).trim();
    return values[t] != null ? String(values[t]) : '';
  });

/** 由申请记录 + 模版构造占位符取值表 */
export const buildCertValues = (app: BrandApplication, ownerCompany: string, custom: Record<string, string>): Record<string, string> => ({
  '公司名称': app.companyName, '纳税人识别码': app.taxpayerCode, '法人代表': app.legalPerson,
  '经营地址': app.address, '联系电话': app.phone, '授权平台': app.platform, '授权平台网址': app.platformUrl,
  '保证金': app.deposit, '授权编号': app.authNo, '品牌名称': app.brandName, '商标号': app.trademarkNo,
  '类目': app.category, '店铺名称': app.shopName, '店铺ID': app.shopId || '', '店铺类型': app.shopType || '', '有效期起': app.validFrom, '有效期止': app.validTo,
  '落款公司': ownerCompany, '落款日期': app.certAt || todayCn(),
  ...custom,
});

// ============ 编号 / 日期 ============
export const genKey = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

/** 申请编号：BA-yyyymmdd-当日流水3位（按已有编号最大值+1） */
export const genAppNo = (existing: BrandApplication[]): string => {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  let max = 0;
  (existing || []).forEach(a => {
    const m = String(a.appNo || '').match(new RegExp(`^BA-${ymd}-(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return `BA-${ymd}-${String(max + 1).padStart(3, '0')}`;
};

/** 公开查询凭证：随机不可猜测 */
export const genShareCode = (): string =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 8)}`;

export const todayCn = (): string => {
  const d = new Date();
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日`;
};
export const todayIso = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 授权编号格式配置：前缀 + 中段 + 日期段 + 分隔符 + 流水位数 */
export interface AuthNoFmt {
  prefix: string;                 // 前缀（如 SQ）
  mid: string;                    // 中段（默认所有者大写缩写，可自定义/留空）
  dateFmt: 'YYYYMMDD' | 'YYYYMM' | 'YYYY' | '';   // 日期段格式，空串=无日期段
  sep: string;                    // 分隔符（- / _ / 空）
  digits: number;                 // 流水号位数
}
export const authFmtKey = (owner: string) => `brandauth_authfmt_${owner}`;
export const defaultAuthFmt = (owner: string): AuthNoFmt => ({
  prefix: 'SQ',
  mid: (owner || 'ZZ').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6),
  dateFmt: 'YYYYMMDD',
  sep: '-',
  digits: 3,
});
/** 按格式配置生成授权编号：各段以分隔符拼接 + 流水号（同前缀当日/当月累计+1） */
export const buildAuthNo = (fmt: AuthNoFmt, owner: string, existing: BrandApplication[]): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const dateSeg = fmt.dateFmt === 'YYYYMMDD' ? `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    : fmt.dateFmt === 'YYYYMM' ? `${d.getFullYear()}${p(d.getMonth() + 1)}`
      : fmt.dateFmt === 'YYYY' ? `${d.getFullYear()}` : '';
  const parts = [fmt.prefix, fmt.mid, dateSeg].filter(s => s !== '');
  const prefixStr = parts.join(fmt.sep) + (parts.length ? fmt.sep : '');
  const seq = existing.filter(x => (x.authNo || '').startsWith(prefixStr)).length + 1;
  return `${prefixStr}${String(seq).padStart(fmt.digits || 3, '0')}`;
};

/** 授权编号：SQ-<所有者大写>-<yyyymmdd>-<3位流水>（默认格式，可经 buildAuthNo 自定义） */
export const genAuthNo = (owner: string, existing: BrandApplication[]): string => buildAuthNo(defaultAuthFmt(owner), owner, existing);

// ============ 打印 ============
/** px→mm（96dpi 基准）：部分打印驱动不按 96dpi 映射 px，导致纸质输出整体缩放偏离 A4；改用物理单位保证纸张实际尺寸 */
const pxToMmCss = (css: string): string => css.replace(/(\d+(?:\.\d+)?)px/g, (_m, n: string) => `${+(Number(n) * 25.4 / 96).toFixed(3)}mm`);
/** 仅转换 style 属性内的 px：避免误改 base64 背景图数据中形如 数字+px 的字符序列 */
const pxToMmHtml = (html: string): string => html.replace(/style="([^"]*)"/g, (_m, css: string) => `style="${pxToMmCss(css)}"`);

/** 通过隐藏 iframe 打印授权书 HTML */
export const printHtml = (html: string, title = '授权书'): void => {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (!doc) { document.body.removeChild(iframe); return; }
  doc.open();
  // @page A4 零边距 + 全物理 mm 单位：证书页用 CSS !important 强制容器铺满 A4（不依赖 pxToMmHtml 保留 min-height，避免正则误删）；
  // 协议书等流式文档按内容自动分页
  const isCertPage = html.includes('min-height:1050px');
  const mmHtml = pxToMmHtml(html);
  const certCss = isCertPage ? `<style>.cert-page{width:210mm!important;height:297mm!important;min-height:297mm!important;padding:0!important;margin:0!important;box-sizing:border-box!important;overflow:hidden!important}</style>` : '';
  const bodyHtml = isCertPage ? `<div class="cert-page">${mmHtml}</div>` : mmHtml;
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>@page{size:A4 portrait;margin:0}html,body{margin:0;padding:0;width:210mm;height:297mm;overflow:hidden}body{font-family:"SimSun","Songti SC",serif}${certCss}</style>
    </head><body>${bodyHtml}</body></html>`);
  doc.close();
  iframe.contentWindow?.focus();
  setTimeout(() => {
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 800);
  }, 200);
};

/** 旧版纯文本模版 → 富文本 HTML（逐行转 div） */
export const bodyToHtml = (body: string): string =>
  String(body || '').split(/\n/).map(line => (line === '' ? '<div><br></div>' : `<div>${escapeHtml(line)}</div>`)).join('');

/** 将富文本中的 {占位符} 替换为取值（转义后插入，保留周围内联样式） */
export const substituteTokens = (html: string, values: Record<string, string>): string => {
  let out = String(html || '');
  Object.keys(values).forEach(k => { out = out.split(`{${k}}`).join(escapeHtml(String(values[k] ?? ''))); });
  return out;
};

/** 字体族写入 HTML style 属性时须将双引号转单引号，否则会截断 style 属性导致后续样式（含对齐）全部丢失 */
const attrFontFamily = (f: string): string => String(f || '').replace(/"/g, "'");

/** 基础字体/字号注入到每个块元素（div/p/blockquote）的内联样式：
 *  避免选区操作遗留在块上的旧内联字体样式覆盖基础设置；
 *  块级 line-height/letter-spacing/text-align 为用户选区级排版，原样保留；
 *  span 级（选区局部）格式不受影响。 */
export const applyBlockTypography = (html: string, style?: Partial<CertStyle>): string => {
  const s: CertStyle = { ...DEFAULT_CERT_STYLE, ...(style || {}) };
  const props = `font-family:${attrFontFamily(s.fontFamily)};font-size:${s.fontSize}px`;
  return String(html || '').replace(/<(div|p|blockquote)\b([^>]*)>/gi, (_m, tag: string, attrs: string) => {
    let touched = false;
    const clean = attrs.replace(/style\s*=\s*("([^"]*)"|'([^']*)')/i, (_m2, _full, dq, sq) => {
      touched = true;
      let css = String(dq ?? sq ?? '');
      css = css.replace(/(font-family|font-size)\s*:[^;]+;?/gi, '');
      return `style="${props};${css}"`;
    });
    return touched ? `<${tag}${clean}>` : `<${tag}${attrs} style="${props}">`;
  });
};

/** 富文本模版 → 授权书页面 HTML（外层纸张容器：背景图 + 页面级排版 + 水印层）
 *  背景图用绝对定位 <img> 而非 CSS background-image：浏览器打印默认不印背景图形，<img> 保证纸质输出带底图 */
export const buildCertPageHtml = (innerHtml: string, bgImage: string, style?: Partial<CertStyle>, watermarkHtml = ''): string => {
  const s: CertStyle = { ...DEFAULT_CERT_STYLE, ...(style || {}) };
  const bgImg = bgImage ? `<img src="${bgImage}" alt="" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;z-index:0" />` : '';
  return `<div style="position:relative;overflow:hidden;min-height:1050px;padding:${s.padTop}px ${s.padRight ?? s.padSide}px ${s.padBottom ?? s.padTop}px ${s.padLeft ?? s.padSide}px;font-family:${attrFontFamily(s.fontFamily)};color:${s.color};font-size:${s.fontSize}px;line-height:${s.lineHeight};letter-spacing:${s.letterSpacing}px">
    ${bgImg}
    ${watermarkHtml}
    <div style="position:relative">${applyBlockTypography(innerHtml, s)}</div>
  </div>`;
};

/** 组装授权书可打印/可预览 HTML（含背景图 + 排版样式） */
export const buildCertHtml = (renderedText: string, bgImage: string, style?: Partial<CertStyle>): string => {
  const s: CertStyle = { ...DEFAULT_CERT_STYLE, ...(style || {}) };
  const paragraphs = String(renderedText || '').split(/\n/).map(line =>
    line.trim() === '' ? '<div style="height:14px"></div>'
      : `<p style="margin:0 0 10px;line-height:${s.lineHeight};font-size:${s.fontSize}px;letter-spacing:${s.letterSpacing}px;text-indent:${s.indent}em;text-align:${s.align};white-space:pre-wrap">${escapeHtml(line)}</p>`).join('');
  // 同 buildCertPageHtml：背景用 <img> 保证打印可见
  const bgImg = bgImage ? `<img src="${bgImage}" alt="" style="position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;z-index:0" />` : '';
  return `<div style="position:relative;min-height:1050px;padding:${s.padTop}px ${s.padRight ?? s.padSide}px ${s.padBottom ?? s.padTop}px ${s.padLeft ?? s.padSide}px;font-family:${attrFontFamily(s.fontFamily)};color:${s.color};font-weight:${s.bold ? 'bold' : 'normal'}">
    ${bgImg}
    <div style="position:relative">${paragraphs}</div>
  </div>`;
};

export const escapeHtml = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ============ 授权书递送（代理商可见） ============
/** 代理商后台镜像键（owner=代理商账号，代理商登录时自动同步拉取） */
export const certMirrorKey = (agentUsername: string) => `brandauth_cert_${agentUsername}`;
/** 公开查询键（owner=shareCode，不被任何租户 pull，仅凭链接直取） */
export const certPubKey = (shareCode: string) => `brandauth_certpub_${shareCode}`;

export interface BrandCertView {
  appKey: string;
  ownerCompany: string;
  companyName: string;
  brandName: string; trademarkNo: string; category: string; shopName: string;
  platform: string; authNo: string;
  validFrom: string; validTo: string;
  status: string;
  certImage: string;
  certHtml: string;
  issuedAt: string;
  shareCode: string;
}

export const buildCertView = (app: BrandApplication, ownerCompany: string, lite = false): BrandCertView => ({
  appKey: app.key,
  ownerCompany,
  companyName: app.companyName,
  brandName: app.brandName, trademarkNo: app.trademarkNo, category: app.category, shopName: app.shopName,
  platform: app.platform, authNo: app.authNo,
  validFrom: app.validFrom, validTo: app.validTo,
  status: app.status,
  certImage: lite ? '' : (app.certImage || ''),
  certHtml: lite ? '' : (app.certHtml || ''),
  issuedAt: app.certImageAt || app.certAt || '',
  shareCode: app.shareCode || '',
});

/** 上传/更新授权书后递送：写公开凭证键（含图） + （若绑定）轻量镜像到代理商后台键（不嵌大图，防配额静默丢写；图由 shareCode 公开键取） */
export const publishCert = (app: BrandApplication, ownerCompany: string): void => {
  const view = buildCertView(app, ownerCompany);
  if (app.shareCode) writeJson(certPubKey(app.shareCode), [view]);
  if (app.agentUsername) {
    const mk = certMirrorKey(app.agentUsername);
    const liteView = buildCertView(app, ownerCompany, true);
    const list = safeJson<BrandCertView[]>(mk, []).filter(x => x.appKey !== app.key);
    writeJson(mk, [...list, liteView]);
  }
};

// ============ 申请单镜像（代理商后台可见申请进度） ============
/** 代理商后台申请镜像键（owner=代理商账号） */
export const appMirrorKey = (agentUsername: string) => `brandauth_appmir_${agentUsername}`;

export interface BrandAppView {
  appKey: string;
  appNo: string;
  ownerCompany: string;
  companyName: string;
  brandName: string; trademarkNo: string;
  platform: string; shopName: string;
  deposit: string;
  status: string;
  rejectReason?: string;
  appliedAt: string;
  authNo: string;
  certImage: string;
  certHtml: string;
  issuedAt: string;
  shareCode: string;
  brandOwner: string;              // 品牌方 owner key（代理商发起退回申请时用）
  depositState: string;            // 保证金状态：''/已确认/已退回
  refundShot: string;              // 退回付款截图（品牌方回传）
  refundAt: string;
  validTo: string;                 // 授权有效期止（代理商侧展示到期时间/续签门控）
}

export const buildAppView = (app: BrandApplication, ownerCompany: string, brandOwner = ''): BrandAppView => ({
  appKey: app.key,
  appNo: app.appNo || '',
  ownerCompany,
  companyName: app.companyName,
  brandName: app.brandName, trademarkNo: app.trademarkNo,
  platform: app.platform, shopName: app.shopName,
  deposit: app.deposit,
  status: app.status,
  appliedAt: app.appliedAt,
  authNo: app.authNo,
  certImage: '',                 // 镜像不嵌大图（防 localStorage 配额静默丢写）；代理商端按 shareCode 经公开凭证键实时取图
  certHtml: '',
  issuedAt: app.certImageAt || app.certAt || '',
  shareCode: app.shareCode || '',
  brandOwner,
  depositState: app.depositState || '',
  refundShot: app.refundShot || '',
  refundAt: app.refundAt || '',
  validTo: app.validTo || '',
  rejectReason: app.rejectReason || '',
});

/** 申请/状态变更时镜像到代理商后台（提交即可见，上传授权书后自动带图） */
export const publishAppMirror = (app: BrandApplication, ownerCompany: string, brandOwner = ''): void => {
  if (!app.agentUsername) return;
  const mk = appMirrorKey(app.agentUsername);
  const list = safeJson<BrandAppView[]>(mk, []).filter(x => x.appKey !== app.key);
  writeJson(mk, [...list, buildAppView(app, ownerCompany, brandOwner)]);
};

// ============ 保证金退回申请（代理商 → 品牌方） ============
export interface BrandRefundReq {
  key: string;
  appKey: string;
  brandOwner: string;
  agentUsername: string;
  companyName: string;       // 代理商公司名
  amount: string;
  requestedAt: string;
  status: '已申请' | '已退回' | '已确认' | '已驳回';   // 已退回=品牌方已审核通过待付款；已确认=代理商确认到账（记账完成）；已驳回=品牌方驳回
  images?: string[];              // 代理商申请附件（最多5张）
  reason?: string;                // 申请原因/备注
  confirmedAt?: string;           // 代理商确认到账时间
  rejectReason?: string;          // 品牌方驳回原因
  rejectAt?: string;              // 品牌方驳回时间
  agentBank?: string;             // 代理商收款银行账户（选择或手输值串）
  agentBankNo?: string;           // 匹配到的银行账号（无匹配为空→银行明细忽略）
  brandCompany?: string;          // 品牌方公司名（记账摘要用）
  refundShot?: string;
  refundAt?: string;
  payBankName?: string;
  agentRecv?: string;
}
/** 退回申请键：owner 为品牌方，代理商写入后品牌方服务端/本地可读 */
export const refundReqKey = (brandOwner: string) => `brandauth_refundreq_${brandOwner}`;

// ============ 续签申请（代理商到期前一个月发起，品牌方续签授权书后闭环） ============
export interface BrandRenewReq {
  key: string;
  appKey: string;
  brandOwner: string;
  agentUsername: string;
  companyName: string;
  brandName: string;
  images: string[];                // 续签申请附件（粘贴图片）
  reason: string;                  // 续签说明文字
  requestedAt: string;
  status: '已申请' | '已续签';
  renewAt?: string;
}
/** 续签申请键：owner 为品牌方，代理商写入后品牌方服务端/本地可读 */
export const renewReqKey = (brandOwner: string) => `brandauth_renewreq_${brandOwner}`;
/** 品牌方/代理商读取续签申请列表（服务端优先、本地兜底） */
export const fetchRenewReqs = async (brandOwner: string): Promise<BrandRenewReq[]> => {
  if (!brandOwner) return [];
  let v: any = null;
  try {
    const rec = await fetchServerDataset(renewReqKey(brandOwner));
    if (rec && rec.json) v = JSON.parse(rec.json);
  } catch { /* ignore */ }
  if (!v) v = readLocalJson(renewReqKey(brandOwner));
  return Array.isArray(v) ? v : [];
};

// ============ 销售数据（代理商按月提交交易数据，品牌方查看/分析） ============
export interface BrandSalesRecord {
  key: string;
  appKey: string;
  appNo: string;
  brandOwner: string;
  agentUsername: string;
  companyName: string;
  shopName: string;
  brandName: string;
  month: string;        // YYYY-MM
  qty: number;          // 销售数量
  amount: number;       // 销售额
  score: number;        // 店铺评分
  images: string[];     // 交易凭证图（最多5张）
  submittedAt: string;
}
/** 销售数据键（owner=品牌方）：代理商跨租户写入，brandauth_ 前缀自动同步 */
export const salesKey = (brandOwner: string) => `brandauth_sales_${brandOwner}`;
/** 品牌管理负责人名单键（owner=品牌方主账号）：仅负责人+管理员可见全部申请，其余人仅见负责人为自己的 */
export const managersKey = (owner: string) => `brandauth_managers_${owner}`;
/** 服务端优先、本地兜底读取某品牌方名下全部销售数据 */
export const fetchSalesRecords = async (brandOwner: string): Promise<BrandSalesRecord[]> => {
  if (!brandOwner) return [];
  let v: any = null;
  try {
    const rec = await fetchServerDataset(salesKey(brandOwner));
    if (rec && rec.json) v = JSON.parse(rec.json);
  } catch { /* ignore */ }
  if (!v) v = readLocalJson(salesKey(brandOwner));
  return Array.isArray(v) ? v : [];
};
/** 代理商侧读取品牌方申请键全量字段（服务端优先、本地兜底）：供我的授权书列/详情展示开店公司/店铺/保证金截图/付款账户等 */
export const fetchBrandApps = async (brandOwner: string): Promise<BrandApplication[]> => {
  if (!brandOwner) return [];
  let v: any = null;
  try {
    const rec = await fetchServerDataset(`brandauth_apps_${brandOwner}`);
    if (rec && rec.json) v = JSON.parse(rec.json);
  } catch { /* ignore */ }
  if (!v) v = readLocalJson(`brandauth_apps_${brandOwner}`);
  return Array.isArray(v) ? v : [];
};
/** 品牌方/代理商读取退回申请列表（服务端优先、本地兜底） */
export const fetchRefundReqs = async (brandOwner: string): Promise<BrandRefundReq[]> => {
  if (!brandOwner) return [];
  let v: any = null;
  try {
    const rec = await fetchServerDataset(refundReqKey(brandOwner));
    if (rec && rec.json) v = JSON.parse(rec.json);
  } catch { /* ignore */ }
  if (!v) v = readLocalJson(refundReqKey(brandOwner));
  return Array.isArray(v) ? v : [];
};

/** 协议书文档键（owner=品牌方）：承载渲染后的协议书 HTML，供外部申请页下载/查看 */
export const agreementDocKey = (owner: string) => `brandauth_agrdoc_${owner}`;
/** 品牌方发布协议书文档（渲染后 HTML，占位符保留供打印手填） */
export const publishAgreement = (owner: string, html: string): void => {
  writeJson(agreementDocKey(owner), [{ key: 'agr', html, updatedAt: todayIso() }]);
};
/** 外部申请页读取协议书文档（服务端优先、本地兜底） */
export const fetchAgreement = async (owner: string): Promise<{ html: string; updatedAt: string } | null> => {
  let v: any = null;
  try {
    const rec = await fetchServerDataset(agreementDocKey(owner));
    if (rec && rec.json) v = JSON.parse(rec.json);
  } catch { /* ignore */ }
  if (!v) v = readLocalJson(agreementDocKey(owner));
  return Array.isArray(v) ? (v[0] || null) : (v || null);
};

/** 公开页凭 shareCode 直取授权书（无需登录；服务端优先、本地兜底） */
export const fetchCertByShareCode = async (shareCode: string): Promise<BrandCertView | null> => {
  let v: any = null;
  try {
    const rec = await fetchServerDataset(certPubKey(shareCode));
    if (rec && rec.json) v = JSON.parse(rec.json);
  } catch { /* ignore */ }
  if (!v) v = readLocalJson(certPubKey(shareCode));
  return Array.isArray(v) ? (v[0] || null) : (v || null);
};

// ============ 外部公开读取（无需登录） ============
import { fetchServerDataset } from './serverSync';

/** 本地键直读（服务端不可用时的同浏览器兜底） */
const readLocalJson = (key: string): any | null => {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; }
};

/** 外部申请页直读品牌方自有品牌台账（服务端优先，本地兜底） */
export const fetchOwnBrands = async (owner: string): Promise<{ brandName: string; trademarkNo: string; category: string; signCompany?: string }[]> => {
  let v: any = null;
  try {
    const rec = await fetchServerDataset(baKeys(owner).own);
    if (rec && rec.json) v = JSON.parse(rec.json);
  } catch { /* ignore */ }
  if (!v) v = readLocalJson(baKeys(owner).own);
  if (!Array.isArray(v)) return [];
  return v.map((b: any) => ({ brandName: b.brandName || '', trademarkNo: b.trademarkNo || '', category: b.category || '', signCompany: b.signCompany || '' }));
};

export const fetchPublicInfo = async (owner: string): Promise<PubInfo | null> => {
  let v: any = null;
  try {
    const rec = await fetchServerDataset(baKeys(owner).pub);
    if (rec && rec.json) v = JSON.parse(rec.json);
  } catch { /* ignore */ }
  if (!v) v = readLocalJson(baKeys(owner).pub);
  const o = Array.isArray(v) ? (v[0] || null) : (v || null);
  if (!o) return null;
  return { companyName: o.companyName || '', recv: o.recv || { accountName: '', bankName: '', branchName: '', bankAccountNo: '', note: '' }, brands: Array.isArray(o.brands) ? o.brands : [] };
};

// ============ 品牌素材（品牌方上传，授权书出具后代理商可下载） ============
export interface BrandMaterial {
  key: string;
  name: string;                // 文件名
  mime: string;                // 文件类型
  size: number;                // 字节数
  dataUrl: string;             // base64 内容（图片/压缩包等附件统一存储）
  uploadedAt: string;
}
/** 品牌素材键（owner=品牌方）：按品牌发布，brandauth_ 前缀跨端同步 */
export const brandMatsKey = (owner: string) => `brandauth_brandmats_${owner}`;
/** 品牌方发布素材（仅存有素材的品牌，节省配额） */
export const publishBrandMats = (owner: string, brands: { brandName: string; materials?: BrandMaterial[] }[]): void => {
  writeJson(brandMatsKey(owner), brands.filter(b => (b.materials || []).length).map(b => ({ brandName: b.brandName, materials: b.materials })));
};
/** 代理商侧读取某品牌方素材（服务端优先、本地兜底） */
export const fetchBrandMats = async (owner: string): Promise<{ brandName: string; materials: BrandMaterial[] }[]> => {
  if (!owner) return [];
  let v: any = null;
  try {
    const rec = await fetchServerDataset(brandMatsKey(owner));
    if (rec && rec.json) v = JSON.parse(rec.json);
  } catch { /* ignore */ }
  if (!v) v = readLocalJson(brandMatsKey(owner));
  return Array.isArray(v) ? v : [];
};
