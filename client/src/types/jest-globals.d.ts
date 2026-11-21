// 测试运行时的 jest 全局声明（最小可用子集）
// 说明：本仓库未安装 @types/jest，为避免仅为跑单测引入新依赖，这里手写声明，
// 保证 `tsc --noEmit` 与 CI 构建（fork-ts-checker）不因 describe/it/expect 报未定义。
// 只在本项目使用到的断言范围内提供类型，新增断言时在此补充。
declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void | Promise<void>): void;
declare function beforeEach(fn: () => void): void;
declare function beforeAll(fn: () => void): void;
declare function afterEach(fn: () => void): void;
/** jest.fn() 返回的可调用打桩：除调用外还带 .mock 记录（用例需读 .mock.calls 断言调用次数） */
interface JestMockFn {
  (...args: any[]): any;
  mock: { calls: any[][]; results: any[] };
}
// resetModules/isolateModules：测试需重新加载已捕获原生 setItem 引用的模块
// mock/fn：商品清单对账用例需拦截 dataStore、serverSync 等依赖模块
// 注意：jest.mock 的工厂必须是顶层调用，babel-plugin-jest-hoist 会提升到 import 之前
declare const jest: {
  resetModules(): void;
  isolateModules(fn: () => void): void;
  mock(moduleName: string, factory?: () => unknown, options?: { virtual?: boolean }): void;
  fn(impl?: any): JestMockFn;
};
// 供 `as jest.Mock` 这类类型标注使用（与上面的同名 const 合并：const 出值、namespace 出类型）
declare namespace jest {
  type Mock = JestMockFn;
}

interface JestMatchers {
  toBe(expected: any): void;
  toEqual(expected: any): void;
  toStrictEqual(expected: any): void;
  toBeCloseTo(expected: number, digits?: number): void;
  toBeUndefined(): void;
  toBeDefined(): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeGreaterThan(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toHaveLength(expected: number): void;
  toContain(expected: any): void;
  not: JestMatchers;
}
declare function expect(actual: any): JestMatchers;
