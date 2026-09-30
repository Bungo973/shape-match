import { describe, expect, it } from 'vitest';
import { getTile, posKey } from './board';
import { DEFAULT_CONFIG } from './config';
import { canPlace, expansionCells, normalize, rotate, SHAPES, translate, type InstalledInsert } from './inserts';
import { resolveAction, type ResolutionEvent } from './resolve';
import { boardWith, ins, testCtx } from './test-utils';
import type { Action, Board } from './types';

type WaveEvent = Extract<ResolutionEvent, { type: 'wave' }>;
type MatchesEvent = Extract<ResolutionEvent, { type: 'matches' }>;
const waves = (events: ResolutionEvent[]) => events.filter((e): e is WaveEvent => e.type === 'wave');
const matches = (events: ResolutionEvent[]) => events.filter((e): e is MatchesEvent => e.type === 'matches');
const run = (board: Board, action: Action, inserts: InstalledInsert[]) => resolveAction(board, action, testCtx(1, undefined, inserts));
const ignite = (r: number, c: number): Action => ({ type: 'ignite', at: { r, c } });

// 横向三连：(0,0)(0,1) 为 a，把 (1,2) 的 a 换到 (0,2)
const tripleBoard = (extra: Record<string, string> = {}) => boardWith({ '0,0': 'a', '0,1': 'a', '0,2': 's', '1,2': 'a', ...extra });
const tripleSwap: Action = { type: 'swap', from: { r: 1, c: 2 }, to: { r: 0, c: 2 } };

describe('基数嵌片（锋刃／壁垒／毒囊）', () => {
  it('主动清除同色方块，每格 +2；异色方块不触发', () => {
    // 第 4 行：H 在 (4,0)，(4,1)(4,2) 为攻击，(4,3) 为催化剂填充、(4,4) 为毒气填充
    const board = boardWith({ '4,0': 'H', '4,1': 'a', '4,2': 'a' });
    const res = run(board, ignite(4, 0), [ins('i1', 'blade', [4, 1], [4, 2], [4, 3], [4, 4])]);
    expect(res.socketBonuses).toEqual({ attack: 4, shield: 0, poison: 0 });
    const triggers = waves(res.events)[0]!.insertTriggers;
    expect(triggers.map((t) => t.effect)).toEqual(['base', 'base']);
  });

  it('毒囊认毒气方块', () => {
    const board = boardWith({ '4,0': 'H' });
    // (4,2)(4,4) 为毒气填充，(4,3) 为催化剂填充
    const res = run(board, ignite(4, 0), [ins('i1', 'venomSac', [4, 2], [4, 3], [4, 4], [3, 3])]);
    expect(res.socketBonuses.poison).toBe(4);
  });

  it('被动清除经过基数嵌片不加基数', () => {
    // 点燃后第 0 列下落形成竖三连 (3..5,0)，全部是被动清除
    const board = boardWith({ '2,0': 'a', '3,0': 'a', '4,0': 'H', '5,0': 'a' });
    const res = run(board, ignite(4, 0), [ins('i1', 'blade', [3, 0], [5, 0], [6, 0], [7, 0])]);
    expect(res.passiveClearCount).toBe(3);
    expect(res.socketBonuses.attack).toBe(0);
  });
});

describe('催化盐', () => {
  it('覆盖格上每主动清除一个催化剂，额外多计一个', () => {
    // 第 4 行奇数列为催化剂填充：(4,1)(4,3)(4,5)(4,7)
    const board = boardWith({ '4,0': 'H' });
    const res = run(board, ignite(4, 0), [ins('i1', 'catalystSalt', [4, 1], [4, 2], [4, 3], [4, 4])]);
    expect(res.activeClearsByType.catalyst).toBe(6);
  });
});

describe('土质火药', () => {
  it('主动三连碰到覆盖格，在交换落点产同向直线炸弹', () => {
    const res = run(tripleBoard(), tripleSwap, [ins('i1', 'earthPowder', [0, 0], [1, 0], [2, 0], [3, 0])]);
    const [m] = matches(res.events);
    expect(m!.created).toEqual([expect.objectContaining({ bomb: 'H', at: { r: 0, c: 2 } })]);
    expect(m!.insertTriggers[0]!.effect).toBe('produce');
    // 清除 2 格，另加亲手做出直线炸弹的 +3
    expect(res.activeClearsByType.attack).toBe(5);
  });

  it('被动竖三连碰到覆盖格，按重力最远格产 V', () => {
    const board = boardWith({ '2,0': 'a', '3,0': 'a', '4,0': 'H', '5,0': 'a' });
    const res = run(board, ignite(4, 0), [ins('i1', 'earthPowder', [5, 0], [6, 0], [7, 0], [7, 1])]);
    const passive = matches(res.events).find((m) => m.phase === 'passive')!;
    expect(passive.created).toEqual([expect.objectContaining({ bomb: 'V', at: { r: 5, c: 0 } })]);
    expect(res.passiveClearCount).toBe(2);
  });

  it('没有覆盖格时普通三连不产弹', () => {
    const res = run(tripleBoard(), tripleSwap, []);
    expect(matches(res.events)[0]!.created).toEqual([]);
  });
});

describe('易燃物质', () => {
  it('匹配产出的炸弹生成在覆盖格上，当步引爆且算主动', () => {
    const board = boardWith({ '0,0': 'a', '0,1': 'a', '0,2': 's', '0,3': 'a', '1,2': 'a' });
    const res = run(board, tripleSwap, [ins('i1', 'flammable', [0, 2], [1, 2], [2, 2], [3, 2])]);
    const [w] = waves(res.events);
    expect(w!.phase).toBe('active');
    expect(w!.explosions[0]).toMatchObject({ shape: 'H', origin: { r: 0, c: 2 } });
    expect(w!.insertTriggers[0]!.effect).toBe('ignite');
  });

});

describe('火星陶与震裂石', () => {
  it('火星陶：覆盖格上的 H 引爆时，同一波追加以该格为中心的 3×3', () => {
    const board = boardWith({ '4,0': 'H' });
    const res = run(board, ignite(4, 0), [ins('i1', 'emberClay', [4, 0], [5, 0], [6, 0], [7, 0])]);
    const [w] = waves(res.events);
    expect(w!.explosions.map((e) => e.shape)).toEqual(['H', 'A']);
    expect(w!.explosions[1]!.byInsert).toBe('i1');
    // 第 4 行 7 格 + 3×3 中第 3、5 行的 (r,0)(r,1) 共 4 格
    const total = Object.values(res.activeClearsByType).reduce((a, b) => a + b, 0);
    expect(total).toBe(11);
  });

  it('震裂石：覆盖格上的 A 引爆时范围改为 5×5', () => {
    const board = boardWith({ '4,4': 'A' });
    const res = run(board, ignite(4, 4), [ins('i1', 'quakeStone', [4, 4], [4, 5], [4, 6], [4, 7])]);
    const e = waves(res.events)[0]!.explosions[0]!;
    expect(e.shape).toBe('square5');
    expect(e.cells).toHaveLength(25);
  });

  it('炸弹组合技不受火星陶影响', () => {
    const board = boardWith({ '3,3': 'H', '3,4': 'V' });
    const res = run(board, { type: 'swap', from: { r: 3, c: 3 }, to: { r: 3, c: 4 } }, [ins('i1', 'emberClay', [3, 3], [3, 4], [2, 3], [2, 4])]);
    expect(waves(res.events)[0]!.explosions.map((e) => e.shape)).toEqual(['cross']);
  });
});

describe('火药嵌片', () => {
  it('爆炸碰到任一覆盖格，连带清除整块；其中的炸弹下一波引爆', () => {
    const board = boardWith({ '4,0': 'H', '5,7': 'V' });
    const res = run(board, ignite(4, 0), [ins('i1', 'blastPowder', [4, 6], [4, 7], [5, 6], [5, 7])]);
    const [w0, w1] = waves(res.events);
    expect(w0!.insertTriggers).toEqual([expect.objectContaining({ effect: 'powder', at: [{ r: 5, c: 6 }, { r: 5, c: 7 }] })]);
    expect(w0!.queued.map((q) => q.at)).toEqual([{ r: 5, c: 7 }]);
    expect(w1!.explosions[0]!.shape).toBe('V');
  });

  it('空触发不算触发：整块已被爆炸覆盖时没有连带效果', () => {
    const board = boardWith({ '4,0': 'H' });
    const res = run(board, ignite(4, 0), [ins('i1', 'blastPowder', [4, 4], [4, 5], [4, 6], [4, 7])]);
    expect(res.triggeredInsertIds).toEqual([]);
  });

  it('被压制的嵌片整条规则失效', () => {
    const board = boardWith({ '4,0': 'H' });
    const res = run(board, ignite(4, 0), [{ ...ins('i1', 'blastPowder', [4, 6], [4, 7], [5, 6], [5, 7]), suppressed: true }]);
    expect(res.triggeredInsertIds).toEqual([]);
  });
});

describe('嵌片几何', () => {
  const size = { rows: 8, cols: 8 };

  it('旋转四次回到原形；I 形旋转一次变为竖条', () => {
    for (const shape of Object.values(SHAPES)) {
      expect(rotate(rotate(rotate(rotate(shape))))).toEqual(normalize(shape));
    }
    expect(rotate(SHAPES.I)).toEqual([{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 2, c: 0 }, { r: 3, c: 0 }]);
  });

  it('落位不能越界、不能重叠、不能超过安装上限', () => {
    const placed = [ins('i1', 'blade', [0, 0], [0, 1], [1, 0], [1, 1])];
    expect(canPlace(size, placed, translate(SHAPES.I, { r: 7, c: 5 }), DEFAULT_CONFIG.maxInstalledInserts)).toBe(false);
    expect(canPlace(size, placed, translate(SHAPES.I, { r: 1, c: 0 }), DEFAULT_CONFIG.maxInstalledInserts)).toBe(false);
    expect(canPlace(size, placed, translate(SHAPES.I, { r: 2, c: 0 }), DEFAULT_CONFIG.maxInstalledInserts)).toBe(true);
    const six = Array.from({ length: 6 }, (_, i) => ins(`x${i}`, 'blade', [i, 7]));
    expect(canPlace(size, six, translate(SHAPES.I, { r: 7, c: 0 }), DEFAULT_CONFIG.maxInstalledInserts)).toBe(false);
  });

  it('升级只能添加正交相邻、在界内、未被占用的格', () => {
    const a = ins('i1', 'blade', [0, 0], [0, 1], [1, 0], [1, 1]);
    const b = ins('i2', 'bulwark', [0, 2], [1, 2], [2, 2], [3, 2]);
    const cells = expansionCells(size, [a, b], a).map(posKey);
    expect(cells).toEqual([posKey({ r: 2, c: 0 }), posKey({ r: 2, c: 1 })]);
  });
});
