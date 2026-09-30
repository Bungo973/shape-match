import { describe, expect, it } from 'vitest';
import { getTile, posKey } from './board';
import { resolveAction, type ResolutionEvent } from './resolve';
import { defaultLevels, type UpgradeLevels } from './upgrades';
import { boardWith, randomCtx, testCtx } from './test-utils';
import { COLORS, type Board, type Pos } from './types';

type WaveEvent = Extract<ResolutionEvent, { type: 'wave' }>;
type MatchesEvent = Extract<ResolutionEvent, { type: 'matches' }>;

const waves = (events: ResolutionEvent[]) => events.filter((e): e is WaveEvent => e.type === 'wave');
const matches = (events: ResolutionEvent[]) => events.filter((e): e is MatchesEvent => e.type === 'matches');
const keys = (cells: Pos[]) => cells.map(posKey).sort((a, b) => a - b);
const rectKeys = (r0: number, r1: number, c0: number, c1: number) => {
  const out: number[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(posKey({ r, c }));
  return out.sort((a, b) => a - b);
};
const countColor = (board: Board, color: string) => board.flat().filter((t) => t?.kind === 'normal' && t.color === color).length;

describe('行动合法性', () => {
  it('同色普通方块、非相邻、点燃非炸弹都无效且不耗 AP', () => {
    const board = boardWith({ '0,0': 'a', '0,1': 'a' });
    expect(resolveAction(board, { type: 'swap', from: { r: 0, c: 0 }, to: { r: 0, c: 1 } }, testCtx()).apSpent).toBe(0);
    expect(resolveAction(board, { type: 'swap', from: { r: 0, c: 0 }, to: { r: 2, c: 0 } }, testCtx()).reason).toBe('notAdjacent');
    expect(resolveAction(board, { type: 'ignite', at: { r: 0, c: 0 } }, testCtx()).reason).toBe('notBomb');
  });

});

describe('主动匹配与产弹', () => {
  it('例 1：一次交换形成两组竖四连，各在自己的落点产 V', () => {
    const board = boardWith({
      '1,2': 's', '2,2': 's', '3,2': 'a', '4,2': 's',
      '1,3': 'a', '2,3': 'a', '3,3': 's', '4,3': 'a',
    });
    const res = resolveAction(board, { type: 'swap', from: { r: 3, c: 2 }, to: { r: 3, c: 3 } }, testCtx());
    const [m] = matches(res.events);
    expect(m!.phase).toBe('active');
    expect(m!.created.map((x) => [x.bomb, x.at])).toEqual([
      ['V', { r: 3, c: 2 }],
      ['V', { r: 3, c: 3 }],
    ]);
    // 亲手做出直线炸弹：每组清除 3 格，另加直线炸弹 1 级的 +3
    expect(res.activeClearsByType).toMatchObject({ attack: 6, shield: 6 });
    expect(m!.groups.map((g) => g.bonus)).toEqual([3, 3]);
  });

  it('例 2：T 形含五连，只在交换落点产一枚 CB，其余 6 格主动清除，另加五连炸弹的 +6', () => {
    const board = boardWith({
      '4,0': 'a', '4,1': 'a', '4,3': 'a', '4,4': 'a', '2,2': 'a', '3,2': 'a', '5,2': 'a', '4,2': 's',
    });
    const res = resolveAction(board, { type: 'swap', from: { r: 5, c: 2 }, to: { r: 4, c: 2 } }, testCtx());
    const [m] = matches(res.events);
    expect(m!.created).toEqual([expect.objectContaining({ bomb: 'CB', at: { r: 4, c: 2 } })]);
    expect(res.activeClearsByType.attack).toBe(12);
  });

  it('普通三连没有炸弹加成', () => {
    const board = boardWith({ '0,0': 'a', '0,1': 'a', '0,2': 's', '1,2': 'a' });
    const res = resolveAction(board, { type: 'swap', from: { r: 1, c: 2 }, to: { r: 0, c: 2 } }, testCtx());
    expect(res.activeClearsByType.attack).toBe(3);
  });
});

describe('升级表：等级 × 基础值', () => {
  const withLevels = (levels: Partial<UpgradeLevels>) => ({ ...testCtx(), levels: { ...defaultLevels(), ...levels } });

  it('方块等级：攻击 3 级时主动三连计 9，其他颜色不受影响', () => {
    const board = boardWith({ '0,0': 'a', '0,1': 'a', '0,2': 's', '1,2': 'a' });
    const res = resolveAction(board, { type: 'swap', from: { r: 1, c: 2 }, to: { r: 0, c: 2 } }, withLevels({ attack: 3 }));
    expect(res.activeClearsByType.attack).toBe(9);
  });

  it('炸弹等级：直线炸弹 2 级，亲手做出四连时该组 +6；方块等级同时生效', () => {
    const board = boardWith({
      '1,2': 's', '2,2': 's', '3,2': 'a', '4,2': 's',
      '1,3': 'a', '2,3': 'a', '3,3': 's', '4,3': 'a',
    });
    const res = resolveAction(board, { type: 'swap', from: { r: 3, c: 2 }, to: { r: 3, c: 3 } }, withLevels({ line: 2, shield: 2 }));
    // 攻击组：3 格 + 6；护盾组：3 格 × 2 级 + 6
    expect(res.activeClearsByType).toMatchObject({ attack: 9, shield: 12 });
  });

  it('主动爆炸清除的方块按方块等级计入基数', () => {
    const board = boardWith({ '0,0': 'H', '0,1': 'a', '0,2': 'a', '0,3': 's' });
    const res = resolveAction(board, { type: 'ignite', at: { r: 0, c: 0 } }, withLevels({ attack: 2 }));
    const clearedAttack = res.events
      .flatMap((e) => (e.type === 'wave' && e.phase === 'active' ? e.cleared : []))
      .filter((c) => c.tile.kind === 'normal' && c.tile.color === 'attack').length;
    expect(res.activeClearsByType.attack).toBe(clearedAttack * 2);
  });

  it('被动阶段不受等级影响，只计入 P', () => {
    const board = boardWith({ '2,0': 'a', '3,0': 'a', '4,0': 'H', '5,0': 'a' });
    const base = resolveAction(board, { type: 'ignite', at: { r: 4, c: 0 } }, testCtx());
    const leveled = resolveAction(board, { type: 'ignite', at: { r: 4, c: 0 } }, withLevels({ attack: 5, line: 5 }));
    expect(leveled.passiveClearCount).toBe(base.passiveClearCount);
  });
});

describe('点燃与接力', () => {
  it('点燃 H 清整行；行内的 V 在下一波接力清整列', () => {
    const board = boardWith({ '4,0': 'H', '4,5': 'V' });
    const res = resolveAction(board, { type: 'ignite', at: { r: 4, c: 0 } }, testCtx());
    const [w0, w1] = waves(res.events);
    expect(w0!.explosions[0]!.shape).toBe('H');
    expect(w0!.queued).toEqual([expect.objectContaining({ at: { r: 4, c: 5 } })]);
    expect(w1!.explosions[0]!.shape).toBe('V');
    // 行内 6 格普通方块 + 列内 7 格，两枚炸弹自身不计基数
    const total = COLORS.reduce((s, c) => s + res.activeClearsByType[c], 0);
    expect(total).toBe(13);
  });

  it('被动匹配只计入 P：点燃后下落形成竖三连，倍率 ×2', () => {
    const board = boardWith({ '2,0': 'a', '3,0': 'a', '4,0': 'H', '5,0': 'a' });
    const res = resolveAction(board, { type: 'ignite', at: { r: 4, c: 0 } }, testCtx());
    expect(res.activeClearsByType).toEqual({ attack: 0, shield: 0, poison: 3, catalyst: 4 });
    const passive = matches(res.events).filter((m) => m.phase === 'passive');
    expect(passive).toHaveLength(1);
    expect(res.passiveClearCount).toBe(3);
  });
});

describe('炸弹组合技', () => {
  const swap = (board: Board, from: Pos, to: Pos, seed = 1) => resolveAction(board, { type: 'swap', from, to }, randomCtx(seed));
  const firstExplosion = (res: ReturnType<typeof swap>) => waves(res.events)[0]!.explosions[0]!;

  it('H+V 形成十字，锚点为先选炸弹的落点；正反交换锚点不同', () => {
    const board = boardWith({ '3,3': 'H', '3,4': 'V' });
    const forward = firstExplosion(swap(board, { r: 3, c: 3 }, { r: 3, c: 4 }));
    expect(forward.shape).toBe('cross');
    expect(forward.origin).toEqual({ r: 3, c: 4 });
    const backward = firstExplosion(swap(board, { r: 3, c: 4 }, { r: 3, c: 3 }));
    expect(backward.origin).toEqual({ r: 3, c: 3 });
    expect(keys(backward.cells)).toContain(posKey({ r: 0, c: 3 }));
  });

  it('A+H 以交换后 H 所在行为中心清三行，边缘裁剪', () => {
    const board = boardWith({ '0,3': 'A', '0,4': 'H' });
    const e = firstExplosion(swap(board, { r: 0, c: 3 }, { r: 0, c: 4 }));
    expect(e.shape).toBe('rows3');
    expect(keys(e.cells)).toEqual(rectKeys(0, 1, 0, 7));
  });

  it('A+V 以交换后 V 所在列为中心清三列，边缘裁剪', () => {
    const board = boardWith({ '4,7': 'A', '3,7': 'V' });
    const e = firstExplosion(swap(board, { r: 4, c: 7 }, { r: 3, c: 7 }));
    expect(e.shape).toBe('cols3');
    expect(keys(e.cells)).toEqual(rectKeys(0, 7, 6, 7));
  });

  it('A+A 以先选炸弹落点为中心清 5×5，正反交换范围不同', () => {
    const board = boardWith({ '0,0': 'A', '0,1': 'A' });
    expect(keys(firstExplosion(swap(board, { r: 0, c: 0 }, { r: 0, c: 1 })).cells)).toEqual(rectKeys(0, 2, 0, 3));
    expect(keys(firstExplosion(swap(board, { r: 0, c: 1 }, { r: 0, c: 0 })).cells)).toEqual(rectKeys(0, 2, 0, 2));
  });

  it('CB 与普通方块交换：按对方类型清除全部该类普通方块', () => {
    const board = boardWith({ '3,3': 'B', '3,4': 'a', '0,0': 'a', '7,7': 'a' });
    const res = swap(board, { r: 3, c: 3 }, { r: 3, c: 4 });
    const e = firstExplosion(res);
    expect(e.shape).toBe('CB');
    expect(e.targetColor).toBe('attack');
    expect(res.activeClearsByType.attack).toBe(3);
  });

  it('CB+H：随机抽现存类型，全部改造成直线炸弹并在下一波引爆；同种子结果一致', () => {
    const board = boardWith({ '3,3': 'B', '3,4': 'H' });
    const a = swap(board, { r: 3, c: 3 }, { r: 3, c: 4 }, 42);
    const b = swap(board, { r: 3, c: 3 }, { r: 3, c: 4 }, 42);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    const [w0, w1] = waves(a.events);
    expect(w0!.converted.length).toBe(31); // 填充棋盘中每种颜色约各半；62 格普通方块中被抽中的类型
    expect(w0!.converted.every((x) => x.bomb === 'H' || x.bomb === 'V')).toBe(true);
    expect(w1!.explosions.length).toBe(w0!.converted.length);
  });

  it('CB+CB 视为全盘爆炸：所有普通方块主动清除', () => {
    const board = boardWith({ '3,3': 'B', '3,4': 'B' });
    const res = swap(board, { r: 3, c: 3 }, { r: 3, c: 4 });
    expect(firstExplosion(res).shape).toBe('board');
    const total = COLORS.reduce((s, c) => s + res.activeClearsByType[c], 0);
    expect(total).toBe(62);
    expect(countColor(res.board, 'attack') + countColor(res.board, 'shield')).toBeGreaterThan(0); // 已补位
  });
});
