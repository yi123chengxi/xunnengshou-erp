/**
 * 账号权限「保存后重开毫无变化」根因回归
 *
 * 缺陷结构（AccountManage 编辑弹窗原样）：
 *  - dataSource 状态 + 「state 变化才写 localStorage」的持久化 effect
 *  - 「perm-changed / storage / focus → 从 localStorage 重读并 applyIfChanged 覆盖 state」的跨端 reload effect
 *  - 保存处理器在 promise.then 里：先 setDataSource(带副作用的 updater)，再同步广播 perm-changed
 * React 18 把同一批次内的 setState 延后到微任务结束才结算，而事件是同步派发的：
 * reload 读到「还没落盘的旧快照」，紧随其后的第二个 setState 把编辑结果整体覆盖回旧值，
 * 持久化 effect 又因内容相同跳过写入 → 提示成功，实际什么都没保存。
 *
 * 修复契约：保存路径必须先同步写 localStorage，再更新内存态、再广播事件（commitRows）。
 */
import React, { useState, useEffect } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { applyIfChanged } from '../useDatasetSyncReload';

type Row = { key: string; name: string; customPermissions: string[] };

const STORAGE_KEY = 'accounts_qatest';
const OLD_ROW: Row = { key: 'acc_1', name: '张三', customPermissions: ['product/finished-product'] };
const NEW_ROW: Row = { ...OLD_ROW, customPermissions: ['product/finished-product', 'market/mold'] };

/** 事件回灌监听（两种写法共用，与 AccountManage 的 reload effect 同构） */
const useReloadOnEvents = (setter: (updater: (prev: Row[]) => Row[]) => void) => {
  useEffect(() => {
    const reload = () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      applyIfChanged<Row[]>(setter, JSON.parse(raw));
    };
    window.addEventListener('perm-changed', reload);
    return () => window.removeEventListener('perm-changed', reload);
  }, []); // eslint-disable-line
};

/** 旧写法：副作用藏在 setState updater 里，落盘交给 effect，事件在落盘前同步广播 */
function LegacyPage({ probe }: { probe: { registry: string[][] } }) {
  const [rows, setRows] = useState<Row[]>([OLD_ROW]);
  useEffect(() => {
    const json = JSON.stringify(rows);
    if (localStorage.getItem(STORAGE_KEY) === json) return;
    localStorage.setItem(STORAGE_KEY, json);
  }, [rows]);
  useReloadOnEvents(setRows);

  const save = () => {
    Promise.resolve({}).then(() => {
      setRows(prev => {
        // updater 内的副作用：写「注册表」（AccountManage 里是 persistRegisteredUsers）
        probe.registry = [NEW_ROW.customPermissions];
        return prev.map(r => ({ ...r, customPermissions: NEW_ROW.customPermissions }));
      });
      // saveUserPermOverrides 末尾的 emitPermChanged 等价物
      window.dispatchEvent(new Event('perm-changed'));
    });
  };
  return <button id="legacy" onClick={save}>save</button>;
}

/** 修复写法：commitRows 先同步落盘 + 回读校验，再 setState，最后才广播 */
function FixedPage({ probe, onFail }: { probe: { registry: string[][] }; onFail: () => void }) {
  const [rows, setRows] = useState<Row[]>([OLD_ROW]);
  const rowsRef = useState<{ cur: Row[] }>({ cur: [OLD_ROW] })[0];
  useEffect(() => { rowsRef.cur = rows; }, [rows]);
  useReloadOnEvents(setRows);

  const commitRows = (next: Row[]): boolean => {
    const json = JSON.stringify(next);
    localStorage.setItem(STORAGE_KEY, json);
    if (localStorage.getItem(STORAGE_KEY) !== json) return false;
    rowsRef.cur = next;
    setRows(next);
    return true;
  };

  const save = () => {
    Promise.resolve({}).then(() => {
      const next = rowsRef.cur.map(r => ({ ...r, customPermissions: NEW_ROW.customPermissions }));
      if (!commitRows(next)) { onFail(); return; }
      probe.registry = [next[0].customPermissions];
      window.dispatchEvent(new Event('perm-changed'));
    });
  };
  return <button id="fixed" onClick={save}>save</button>;
}

async function clickAndWait(id: string) {
  act(() => { document.getElementById(id)!.click(); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

const storedRows = (): Row[] => JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');

describe('账号权限保存竞态', () => {
  let host: HTMLDivElement;
  let root: Root;

  const mount = (el: React.ReactElement) => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEY, JSON.stringify([OLD_ROW]));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => { root.render(el); });
  };
  const unmount = () => { act(() => root.unmount()); host.remove(); };

  it('旧写法复现缺陷：注册表副作用已执行，但落盘的账号行仍是旧权限', async () => {
    const probe: { registry: string[][] } = { registry: [] };
    mount(<LegacyPage probe={probe} />);
    await clickAndWait('legacy');

    // updater 确实执行了（注册表拿到新权限）——与线上取证到的「registeredUsers 是新的」一致
    expect(probe.registry[0]).toEqual(NEW_ROW.customPermissions);
    // 但账号列表被自身事件回灌的旧快照覆盖，effect 因内容相同不再写盘
    expect(storedRows()[0].customPermissions).toEqual(OLD_ROW.customPermissions);
    unmount();
  });

  it('修复写法：同一事件时序下落盘的账号行是新权限（重开弹窗即可看到修改）', async () => {
    const probe: { registry: string[][] } = { registry: [] };
    let writeFailed = false;
    mount(<FixedPage probe={probe} onFail={() => { writeFailed = true; }} />);
    await clickAndWait('fixed');

    expect(probe.registry[0]).toEqual(NEW_ROW.customPermissions);
    expect(storedRows()[0].customPermissions).toEqual(NEW_ROW.customPermissions);
    expect(writeFailed).toBe(false);
    unmount();
  });
});
