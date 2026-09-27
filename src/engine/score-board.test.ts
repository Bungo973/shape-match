import { describe, expect, it } from 'vitest';
import { applyGravity, createBoard, createIdGen } from './board';
import { DEFAULT_CONFIG } from './config';
import { findLines } from './match';
import { createRng } from './rng';
import { multiplierFor, settle } from './score';
import type { Board, Tile } from './types';

const zero = { attack: 0, shield: 0, poison: 0, catalyst: 0 };

describe('基数 × 倍率结算（GAME_RULES 例子）', () => {
  it('主例：3 攻击 3 催化剂、P=6、旧充能 1、攻击嵌片 2 → 结算分 68，效果 32/12/12', () => {
    const s = settle(
      {
        activeClearsByType: { ...zero, attack: 3, catalyst: 3 },
        passiveClearCount: 6,
        hadActiveColorClear: true,
        chargesBefore: 1,
        socketBonuses: { attack: 2, shield: 0, poison: 0 },
      },
      DEFAULT_CONFIG,
    );
    expect(s.multiplier).toBe(4);
    expect(s.baseValues).toEqual({ attack: 8, shield: 3, poison: 3 });
    expect(s.settlementScore).toBe(68);
    expect(s.finalEffects).toEqual({ attack: 32, shield: 12, poison: 12 });
    expect(s.chargesAfter).toBe(1);
  });

  it('混合种类例：3 攻击 2 护盾、P=5 → ×2，6 伤害 4 护盾', () => {
    const s = settle(
      { activeClearsByType: { ...zero, attack: 3, shield: 2 }, passiveClearCount: 5, hadActiveColorClear: true, chargesBefore: 0 },
      DEFAULT_CONFIG,
    );
    expect(s.finalEffects).toEqual({ attack: 6, shield: 4, poison: 0 });
  });

  it('倍率封顶 ×8', () => {
    expect([0, 2, 3, 6, 9, 100].map((p) => multiplierFor(p, DEFAULT_CONFIG))).toEqual([1, 1, 2, 4, 8, 8]);
  });

  it('没有主动清除有色方块时保留旧充能；新充能不超过上限', () => {
    const idle = settle({ activeClearsByType: zero, passiveClearCount: 0, hadActiveColorClear: false, chargesBefore: 2 }, DEFAULT_CONFIG);
    expect(idle.chargesUsed).toBe(0);
    expect(idle.chargesAfter).toBe(2);
    const burst = settle(
      { activeClearsByType: { ...zero, catalyst: 9 }, passiveClearCount: 0, hadActiveColorClear: true, chargesBefore: 0 },
      DEFAULT_CONFIG,
    );
    expect(burst.chargesAfter).toBe(2);
  });
});

describe('棋盘生成与重力', () => {
  it('新棋盘没有初始三连，且同种子结果相同', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const b1 = createBoard(createRng(seed), createIdGen(), DEFAULT_CONFIG);
      expect(findLines(b1)).toHaveLength(0);
      const b2 = createBoard(createRng(seed), createIdGen(), DEFAULT_CONFIG);
      expect(JSON.stringify(b2)).toBe(JSON.stringify(b1));
    }
  });

  const column = (): Board => {
    const x: Tile = { id: 1, kind: 'normal', color: 'attack' };
    const y: Tile = { id: 2, kind: 'normal', color: 'shield' };
    return [[x], [null], [y]];
  };

  it('向下重力：方块沉底，新方块从上边缘补入', () => {
    const b = column();
    const { spawns } = applyGravity(b, 'down', createIdGen(100), () => 'poison');
    expect(b.map((row) => row[0]!.id)).toEqual([100, 1, 2]);
    expect(spawns[0]!.to).toEqual({ r: 0, c: 0 });
  });

  it('向上重力：方块向上填补，新方块从下边缘补入', () => {
    const b = column();
    const { spawns } = applyGravity(b, 'up', createIdGen(100), () => 'poison');
    expect(b.map((row) => row[0]!.id)).toEqual([1, 2, 100]);
    expect(spawns[0]!.to).toEqual({ r: 2, c: 0 });
  });
});
