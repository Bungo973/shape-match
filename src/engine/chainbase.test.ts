// 连锁计基数（2026-10-06 原型转正）：连锁清除的普通方块也按方块基数计入基数
import { describe, expect, it } from 'vitest';
import { playerAction, startBattle } from './battle';
import { DEFAULT_CONFIG } from './config';
import { CRYSTAL_MOLE } from './content/enemies';
import { candidateActions } from '../sim/bot';

const on = { ...DEFAULT_CONFIG, scoreMode: true };
const off = { ...on, chainBase: false };

/** 在固定种子的开局棋盘上找一步带连锁的交换 */
function chainStep(level: number) {
  for (let seed = 1; seed < 200; seed++) {
    const s = startBattle({ seed, player: { hp: 40, maxHp: 40, shield: 0, catalystCharges: 0 }, enemy: { ...CRYSTAL_MOLE, targetScore: 1e9 }, levels: { block: level, line: 1, area: 1, color: 1 } }, on);
    for (const action of candidateActions(s.board)) {
      const a = playerAction(s, action, on);
      const b = playerAction(s, action, off);
      if (a.ok && b.ok && a.log.result.passiveClearCount > 3) return { a: a.log, b: b.log };
    }
  }
  throw new Error('没找到带连锁的一步');
}

describe('连锁计基数', () => {
  it('默认开启；关闭时连锁不计基数（旧规则，模拟对照用）', () => {
    expect(DEFAULT_CONFIG.chainBase).toBe(true);
    const { b } = chainStep(1);
    expect(b.result.chainBase).toBe(0);
    expect(b.settlement!.chainBase).toBe(0);
  });

  it('开启时连锁方块计入基数，倍率不变，结算分 = 基数 × 倍率', () => {
    const { a, b } = chainStep(1);
    expect(a.result.chainBase).toBeGreaterThan(0);
    expect(a.result.chainBase).toBeLessThanOrEqual(a.result.passiveClearCount * 3);
    expect(a.settlement!.multiplier).toBe(b.settlement!.multiplier);
    expect(a.settlement!.rawBase).toBe(b.settlement!.rawBase + a.result.chainBase);
    expect(a.settlement!.settlementScore).toBe(Math.round(a.settlement!.base * a.settlement!.multiplier));
  });

  it('连锁方块和主动一样吃方块基数等级', () => {
    const one = chainStep(1).a.result;
    const three = chainStep(3).a.result;
    expect(three.chainBase).toBeGreaterThan(one.chainBase);
  });
});

