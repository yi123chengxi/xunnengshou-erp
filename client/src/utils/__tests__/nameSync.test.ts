// 主体身份索引单测：保证「凭证优先、名称兜底」与「同名歧义不得误归一」两条不变量
import { buildCredIndex } from '../nameSync';

/** 播种注册账号表与改名链：u1 经历 旧名→中间名→新名 两次改名；X 名为未注册主体的改名 */
const seed = () => {
  localStorage.clear();
  localStorage.setItem('registeredUsers', JSON.stringify([
    { username: 'u1', companyName: '甲公司新名', companyShortName: '甲公司', companyNo: 'N1' },
    { username: 'u2', companyName: '同名公司', companyNo: 'N2' },
    { username: 'u3', companyName: '同名公司', companyNo: 'N3' },
  ]));
  localStorage.setItem('company_renames', JSON.stringify([
    // 乱序写入，索引内部必须按 ts 排序后再折叠链
    { key: 'k2', username: 'u1', oldName: '中间甲公司', newName: '甲公司新名', ts: 2000 },
    { key: 'k1', username: 'u1', oldName: '甲公司旧名', newName: '中间甲公司', ts: 1000 },
    { key: 'k3', username: '', oldName: 'X旧名', newName: 'X新名', ts: 1500 },
  ]));
};

beforeEach(() => seed());

describe('buildCredIndex 身份键', () => {
  it('账号凭证优先于名称', () => {
    const idx = buildCredIndex();
    expect(idx.identity({ username: 'u1', name: '随手写的名字' })).toBe('u:u1');
  });

  it('公司编号可独立定位主体', () => {
    const idx = buildCredIndex();
    expect(idx.identity({ no: 'N1' })).toBe('u:u1');
  });

  it('改名链上任意旧名与新名归一为同一主体', () => {
    const idx = buildCredIndex();
    expect(idx.identityOfName('甲公司旧名')).toBe('u:u1');
    expect(idx.identityOfName('中间甲公司')).toBe('u:u1');
    expect(idx.identityOfName('甲公司新名')).toBe('u:u1');
    expect(idx.identityOfName('甲公司')).toBe('u:u1'); // 简称同样可解析
  });

  it('未注册主体退化为折叠名匹配，行为与旧实现一致', () => {
    const idx = buildCredIndex();
    expect(idx.identityOfName('路人公司')).toBe('n:路人公司');
    // 未注册但有改名链时，旧名与新名仍归一（链折叠生效）
    expect(idx.identityOfName('X旧名')).toBe('n:X新名');
    expect(idx.identityOfName('X旧名')).toBe(idx.identityOfName('X新名'));
  });

  it('同名多账号属歧义，禁止按名称归到任一账号', () => {
    const idx = buildCredIndex();
    expect(idx.identityOfName('同名公司')).toBe('n:同名公司');
    expect(idx.credOfName('同名公司')).toBeNull();
  });

  it('无任何可定位信息时返回空串', () => {
    const idx = buildCredIndex();
    expect(idx.identity({})).toBe('');
    expect(idx.identityOfName('   ')).toBe('');
  });

  it('重复构建索引结果稳定（无跨调用状态残留）', () => {
    const a = buildCredIndex();
    const b = buildCredIndex();
    expect(a.identityOfName('甲公司旧名')).toBe(b.identityOfName('甲公司新名'));
    expect(a.currentNameOf('X旧名')).toBe(b.currentNameOf('X旧名'));
  });
});

describe('buildCredIndex 展示名与同主体判定', () => {
  it('currentNameOf 取注册账号表的当前公司全称', () => {
    const idx = buildCredIndex();
    expect(idx.currentNameOf('甲公司旧名')).toBe('甲公司新名');
    expect(idx.currentNameOf('甲公司新名')).toBe('甲公司新名');
  });

  it('currentNameOf 对未注册主体返回链尾名', () => {
    const idx = buildCredIndex();
    expect(idx.currentNameOf('X旧名')).toBe('X新名');
  });

  it('currentNameOf 对无链可折的名称保持原样', () => {
    const idx = buildCredIndex();
    expect(idx.currentNameOf('路人公司')).toBe('路人公司');
    expect(idx.currentNameOf('')).toBe('');
  });

  it('isSameParty 认得改名前后的同一主体', () => {
    const idx = buildCredIndex();
    expect(idx.isSameParty('甲公司旧名', '甲公司新名')).toBe(true);
    expect(idx.isSameParty('甲公司', '甲公司新名')).toBe(true);
    expect(idx.isSameParty('X旧名', 'X新名')).toBe(true);
  });

  it('isSameParty 对明确不同或空白的主体返回 false', () => {
    const idx = buildCredIndex();
    expect(idx.isSameParty('甲公司新名', '路人公司')).toBe(false);
    expect(idx.isSameParty('', '甲公司新名')).toBe(false);
    expect(idx.isSameParty('甲公司新名', '  ')).toBe(false);
  });
});
