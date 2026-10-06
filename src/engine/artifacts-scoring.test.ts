// 第一批计分神器（2026-10-06）：同一棋盘、同一种子，比较带与不带神器时的倍率与得分。
import { describe, expect, it } from 'vitest';
import { ARTIFACT_PARAMS, type ArtifactKey } from './artifacts';
import { playerAction, startBattle, stepsLeft, turnAp, useItem, type BattleState } from './battle';
import { DEFAULT_CONFIG } from './config';
import { multiplierFor } from './score';
import { boardWith } from './test-utils';
import type { Action } from './types';

const config = { ...DEFAULT_CONFIG, scoreMode: true };

function battle(artifacts: ArtifactKey[], board: Record<string, string>): BattleState {
  const s = startBattle(
    {
      seed: 11,
      player: { hp: 40, maxHp: 40, shield: 0, catalystCharges: 0 },
      enemy: { id: 'dummy', name: '木桩', maxHp: 1, targetScore: 1_000_000, script: [{ parts: [] }], fallbackDefend: 0 },
      artifacts,
    },
    config,
  );
  s.board = boardWith(board);
  return s;
}

function act(s: BattleState, action: Action) {
  const out = playerAction(s, action, config);
  if (!out.ok) throw new Error(`行动无效：${out.reason}`);
  return out.log;
}

// 第 0 行 a a . a：把 (0,3) 换到 (0,2)，亲手消除 3 格
const three = { '0,0': 'a', '0,1': 'a', '0,3': 'a' };
const swap3: Action = { type: 'swap', from: { r: 0, c: 3 }, to: { r: 0, c: 2 } };
// 第 4 行放一枚横向直线炸弹，点燃后亲手清除整行 8 格
const bomb = { '4,0': 'H' };
const ignite: Action = { type: 'ignite', at: { r: 4, c: 0 } };

/** 同一步分别不带与带上神器，返回两次的结算 */
function compare(keys: ArtifactKey[], board: Record<string, string>, action: Action, prep?: (s: BattleState) => void) {
  const plain = battle([], board);
  const withIt = battle(keys, board);
  prep?.(plain);
  prep?.(withIt);
  return { plain: act(plain, action), withIt: act(withIt, action) };
}

describe('倍率加成', () => {
  it('红鼻子：倍率 +0.5', () => {
    const { plain, withIt } = compare(['redNose'], three, swap3);
    expect(withIt.settlement!.multiplier).toBeCloseTo(plain.settlement!.multiplier + 0.5);
    expect(withIt.scoringArtifacts).toEqual(['redNose']);
  });

  it('香蕉：倍率 +1.5', () => {
    const { plain, withIt } = compare(['banana'], three, swap3);
    expect(withIt.settlement!.multiplier).toBeCloseTo(plain.settlement!.multiplier + 1.5);
  });

  it('小步：亲手只消 3 格时 +1.5；点燃炸弹清整行时不触发', () => {
    const small = compare(['smallStep'], three, swap3);
    expect(small.withIt.settlement!.multiplier).toBeCloseTo(small.plain.settlement!.multiplier + 1.5);
    const big = compare(['smallStep'], bomb, ignite);
    expect(big.withIt.settlement!.multiplier).toBe(big.plain.settlement!.multiplier);
    expect(big.withIt.scoringArtifacts).toEqual([]);
  });
});

describe('基数乘成', () => {
  it('独行：没有炸弹爆炸时基数 ×2；有炸弹爆炸时不触发', () => {
    const quiet = compare(['loner'], three, swap3);
    const M = quiet.plain.settlement!.multiplier;
    expect(quiet.withIt.settlement!.settlementScore).toBe(Math.round(3 * 2 * M));
    const loud = compare(['loner'], bomb, ignite);
    expect(loud.withIt.settlement!.settlementScore).toBe(loud.plain.settlement!.settlementScore);
  });
});

describe('倍率乘成', () => {
  it('末班车：本回合最后一步倍率乘成，前面的步不触发', () => {
    const first = compare(['lastCall'], three, swap3);
    expect(first.withIt.settlement!.multiplier).toBe(first.plain.settlement!.multiplier);
    const last = compare(['lastCall'], three, swap3, (s) => (s.ap = 1));
    expect(last.withIt.settlement!.multiplier).toBeCloseTo(Math.round(last.plain.settlement!.multiplier * ARTIFACT_PARAMS.lastCallFactor * 10) / 10);
  });

  it('末班车：道具不算一步，最后一步用锤子不触发', () => {
    const s = battle(['lastCall'], bomb);
    s.ap = 1;
    const out = useItem(s, { key: 'hammer', at: { r: 4, c: 0 } }, config);
    if (!out.ok) throw new Error(out.reason);
    expect(out.log!.scoringArtifacts).toEqual([]);
    expect(out.state.ap).toBe(1);
  });

  it('积分卡：本关第 6 步倍率乘成', () => {
    const fifth = compare(['loyaltyCard'], three, swap3, (s) => (s.stepsTaken = 4));
    expect(fifth.withIt.settlement!.multiplier).toBe(fifth.plain.settlement!.multiplier);
    const sixth = compare(['loyaltyCard'], three, swap3, (s) => (s.stepsTaken = 5));
    expect(sixth.withIt.settlement!.multiplier).toBeCloseTo(sixth.plain.settlement!.multiplier * ARTIFACT_PARAMS.loyaltyFactor);
  });

  it('玻璃炮：倍率乘成，每回合少 1 步', () => {
    const { plain, withIt } = compare(['glassCannon'], three, swap3);
    expect(withIt.settlement!.multiplier).toBeCloseTo(plain.settlement!.multiplier * ARTIFACT_PARAMS.glassCannonFactor);
    const s = battle(['glassCannon'], {});
    expect(s.ap).toBe(config.apPerTurn - 1);
    expect(turnAp(s, config)).toBe(config.apPerTurn - 1);
    expect(stepsLeft(s, config)).toBe((config.apPerTurn - 1) * config.scoreTurns);
  });

  it('加成先加、乘成后乘，持有顺序不影响结果；“低压”封顶限制最终倍率', () => {
    const a = compare(['redNose', 'glassCannon'], three, swap3);
    const b = compare(['glassCannon', 'redNose'], three, swap3);
    expect(a.withIt.settlement!.multiplier).toBe(b.withIt.settlement!.multiplier);
    expect(a.withIt.settlement!.multiplier).toBeCloseTo((a.plain.settlement!.multiplier + 0.5) * ARTIFACT_PARAMS.glassCannonFactor);
    const capped = { ...DEFAULT_CONFIG, multiplierUncapped: false, multiplierSegments: [6, 10] };
    expect(multiplierFor(100, capped, 0, 0, 0, 2)).toBe(3);
    expect(multiplierFor(0, capped, 0, 0, 5, 2)).toBe(3);
  });
});

describe('逐件结算明细', () => {
  it('先加后乘逐件记录倍率，最后一件等于结算倍率；没有神器生效时为空', () => {
    const s = battle(['glassCannon', 'loner', 'redNose'], three);
    s.ap = 1;
    const log = act(s, swap3);
    expect(log.tally!.steps.map((t) => t.key)).toEqual(['redNose', 'loner', 'glassCannon']);
    expect(log.tally!.steps.map((t) => t.label)).toEqual(['+0.5', '基数 ×2', `×${ARTIFACT_PARAMS.glassCannonFactor}`]);
    expect(log.tally!.steps[0]!.value).toBeCloseTo(log.tally!.start + 0.5);
    expect(log.tally!.steps.at(-1)!.value).toBe(log.settlement!.multiplier);
    expect(act(battle([], three), swap3).tally).toBeNull();
  });
});
