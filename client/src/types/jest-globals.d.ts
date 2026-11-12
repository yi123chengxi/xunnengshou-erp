// 测试运行时的 jest 全局声明（最小可用子集）
// 说明：本仓库未安装 @types/jest，为避免仅为跑单测引入新依赖，这里手写声明，
// 保证 `tsc --noEmit` 与 CI 构建（fork-ts-checker）不因 describe/it/expect 报未定义。
// 只在本项目使用到的断言范围内提供类型，新增断言时在此补充。
declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void | Promise<void>): void;
declare function beforeEach(fn: () => void): void;
declare function afterEach(fn: () => void): void;

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
