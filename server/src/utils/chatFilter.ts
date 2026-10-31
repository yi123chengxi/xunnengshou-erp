/**
 * 聊天内容安全审核（服务端复核，与客户端 client/src/utils/chatFilter.ts 同源词表）
 * 落库/转发前拦截不文明与违反法律的消息
 */

// 违法违规类关键词（赌博/诈骗/毒品/枪支/色情/非法经营等）
const ILLEGAL_WORDS = [
  '赌博', '网赌', '赌球', '赌球盘', '开盘口', '刷单', '套现', '洗钱', '传销', '非法集资', '诈骗', '杀猪盘', '庞氏',
  '代开发票', '虚开发票', '买发票', '卖发票', '办证', '刻章', '假证', '假币', '走私', '偷税', '漏税教程',
  '毒品', '冰毒', '海洛因', '麻古', '摇头丸', 'k粉', '卡西酮', '大麻', '鸦片', '制毒', '贩毒',
  '枪支', '弹药', '仿真枪', '气枪', '土枪', '爆炸物', '雷管', '炸药', '管制刀具',
  '色情', '黄片', '黄网', '裸聊', '约炮', '一夜情', '援交', '迷药', '春药', '催情药', '听话水',
  '窃听器', '窃照', '偷拍设备', '代孕', '器官买卖', '贩卖个人信息', '买数据', '社工库',
];

// 不文明类关键词（侮辱/谩骂/人身攻击）
const UNCIVIL_WORDS = [
  '傻逼', '煞笔', '沙比', '傻b', '傻比', '沙碧', '妈逼', '麻批', '尼玛', '你妈死了', 'nmsl', 'cnm', 'cnmb',
  '操你', '草你', '艹你', '日你妈', '狗日的', '杂种', '畜生', '王八蛋', '龟儿子', '贱人', '婊子', '妓女',
  '去死吧', '滚你妈', '他妈的', '她妈的', '妈了个逼', 'tmd', 'tm的', '死杂种', '废物东西', '狗杂种', '鳖孙',
  '全家死光', '断子绝孙', '不得好死', '智障东西', '脑残', '弱智吧你',
];

export interface ChatCheckResult {
  blocked: boolean;
  category: '违法' | '不文明' | '';
  word: string;
}

const normalize = (text: string): string => String(text || '').toLowerCase().replace(/\s+/g, '');

export function checkChatContent(text: string): ChatCheckResult {
  const norm = normalize(text);
  if (!norm) return { blocked: false, category: '', word: '' };
  for (const w of ILLEGAL_WORDS) {
    if (norm.includes(w)) return { blocked: true, category: '违法', word: w };
  }
  for (const w of UNCIVIL_WORDS) {
    if (norm.includes(w)) return { blocked: true, category: '不文明', word: w };
  }
  return { blocked: false, category: '', word: '' };
}

export const blockReason = (r: ChatCheckResult): string =>
  `消息含${r.category}违规内容（${r.word}），已被屏蔽，发送失败`;
