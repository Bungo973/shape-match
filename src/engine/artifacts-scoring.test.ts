// 第一批计分神器（2026-10-06）：同一棋盘、同一种子，比较带与不带神器时的倍率与得分。
import { describe, expect, it } from 'vitest';
import { ARTIFACT_PARAMS, type ArtifactKey } from './artifacts';
import { endTurn, playerAction, startBattle, stepsLeft, turnAp, useItem, type BattleState } from './battle';
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

  it('末班车：道具不算一步，最后一步用吸管不触发', () => {
    const s = battle(['lastCall'], three);
    s.ap = 1;
    const out = useItem(s, { key: 'dropper', from: { r: 0, c: 1 }, to: { r: 0, c: 2 } }, config);
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

describe('第二批：炸弹类', () => {
  const explosions = (log: ReturnType<typeof act>) => log.result.events.flatMap((e) => (e.type === 'wave' ? e.explosions : []));

  it('十字引线：直线炸弹在垂直方向也向两侧各清除 2 格', () => {
    const log = act(battle(['crossFuse'], { '4,3': 'H' }), { type: 'ignite', at: { r: 4, c: 3 } });
    const x = explosions(log)[0]!;
    expect(x.byArtifact).toBe('crossFuse');
    expect(x.cells).toHaveLength(8 + 2 * ARTIFACT_PARAMS.crossArm);
    expect(x.cells).toContainEqual({ r: 2, c: 3 });
    expect(x.cells).not.toContainEqual({ r: 1, c: 3 });
  });

  it('大口径：3×3 炸弹扩为 13 格的菱形', () => {
    const log = act(battle(['bigBore'], { '4,4': 'A' }), { type: 'ignite', at: { r: 4, c: 4 } });
    const x = explosions(log)[0]!;
    expect(x.cells).toHaveLength(13);
    expect(x.cells).toContainEqual({ r: 2, c: 4 });
    expect(x.cells).toContainEqual({ r: 3, c: 3 });
    expect(x.cells).not.toContainEqual({ r: 2, c: 3 });
  });

  it('裂变：五连炸弹爆炸后，步末 2 个普通方块变成直线炸弹', () => {
    const s = battle(['fission'], { '4,4': 'B' });
    const out = playerAction(s, { type: 'ignite', at: { r: 4, c: 4 } }, config);
    if (!out.ok) throw new Error(out.reason);
    const t = out.log.counterTriggers.find((c) => c.key === 'fission');
    if (!t || !('cells' in t)) throw new Error('裂变没有触发');
    expect(t.cells).toHaveLength(ARTIFACT_PARAMS.fissionBombs);
    for (const p of t.cells) {
      const tile = out.state.board[p.r]![p.c]!;
      expect(tile.kind === 'bomb' && (tile.bomb === 'H' || tile.bomb === 'V')).toBe(true);
    }
    // 没有五连爆炸时不触发
    expect(act(battle(['fission'], three), swap3).counterTriggers).toEqual([]);
  });

  it('囤积者：结算时棋盘上每枚炸弹倍率 +0.2', () => {
    const board = { ...three, '6,6': 'A', '7,7': 'H' };
    const plain = battle([], board);
    const withIt = battle(['hoarder'], board);
    const a = playerAction(plain, swap3, config);
    const b = playerAction(withIt, swap3, config);
    if (!a.ok || !b.ok) throw new Error('行动无效');
    const bombs = b.state.board.flat().filter((t) => t?.kind === 'bomb').length;
    expect(bombs).toBeGreaterThanOrEqual(2);
    expect(b.log.settlement!.multiplier).toBeCloseTo(a.log.settlement!.multiplier + 0.2 * bombs);
  });

  it('长跑：连续没有炸弹爆炸的步累加 +0.2；有炸弹爆炸清零', () => {
    const s = battle(['marathon'], { ...three, '4,0': 'H' });
    s.player.counters = { marathon: 2 };
    const quiet = playerAction(s, swap3, config);
    if (!quiet.ok) throw new Error(quiet.reason);
    expect(quiet.state.player.counters!.marathon).toBe(3);
    expect(quiet.log.tally!.steps).toEqual([expect.objectContaining({ key: 'marathon', label: `+${(3 * ARTIFACT_PARAMS.marathonTenths) / 10}` })]);
    const loud = playerAction({ ...s, board: battle([], bomb).board }, ignite, config);
    if (!loud.ok) throw new Error(loud.reason);
    expect(loud.state.player.counters!.marathon).toBe(0);
    expect(loud.log.scoringArtifacts).not.toContain('marathon');
  });

  it('尺规：每做出若干枚直线炸弹，基数永久 +1', () => {
    const s = battle(['ruler'], three);
    s.player.counters = { ruler: ARTIFACT_PARAMS.rulerEvery };
    const M = act(battle([], three), swap3).settlement!.multiplier;
    const log = act(s, swap3);
    expect(log.settlement!.settlementScore).toBe(Math.round((3 + 1) * M));
    // 亲手做出四连直线炸弹，计数 +1
    const four = battle(['ruler'], { '0,0': 'a', '0,1': 'a', '0,3': 'a', '1,2': 'a' });
    const out = playerAction(four, { type: 'swap', from: { r: 1, c: 2 }, to: { r: 0, c: 2 } }, config);
    if (!out.ok) throw new Error(out.reason);
    expect(out.state.player.counters!.ruler).toBeGreaterThanOrEqual(1);
  });
});

describe('第三批：节奏、金币与规则（关内）', () => {
  it('收藏家：每持有 1 件神器 +0.3；空位：每个空栏 +1', () => {
    const c = compare(['collector', 'redNose'], three, swap3);
    expect(c.withIt.settlement!.multiplier).toBeCloseTo(c.plain.settlement!.multiplier + 0.6 + 0.5);
    const v = compare(['vacancy'], three, swap3);
    expect(v.withIt.settlement!.multiplier).toBeCloseTo(v.plain.settlement!.multiplier + ((config.artifactSlots - 1) * ARTIFACT_PARAMS.vacancyTenths) / 10);
  });

  it('勋章按次数加倍率；冰淇淋按剩余加基数；富翁按开关时的金币加基数', () => {
    const M = act(battle([], three), swap3).settlement!.multiplier;
    const medal = battle(['medal'], three);
    medal.player.counters = { medal: 3 };
    expect(act(medal, swap3).settlement!.multiplier).toBeCloseTo(M + (3 * ARTIFACT_PARAMS.medalTenths) / 10);
    const ice = battle(['iceCream'], three);
    ice.player.counters = { iceCream: 4 };
    expect(act(ice, swap3).settlement!.settlementScore).toBe(Math.round((3 + ARTIFACT_PARAMS.iceCreamBase - 4) * M));
    const rich = battle(['tycoon'], three);
    rich.gold = 23;
    expect(act(rich, swap3).settlement!.settlementScore).toBe(Math.round((3 + 4) * M));
  });

  it('替身：致命的扣血改为不扣，替身消失；不致命时不触发', () => {
    const s = battle(['standIn'], {});
    s.turn = s.goal!.turns;
    s.player.hp = 5;
    const { state, log } = endTurn(s, config);
    expect(log!.standIn).toBe(true);
    expect(state.player.hp).toBe(5);
    expect(state.outcome).toBe('won');
    expect(state.artifacts).not.toContain('standIn');
    expect(state.spentArtifacts).toEqual(['standIn']);
    const healthy = battle(['standIn'], {});
    healthy.turn = healthy.goal!.turns;
    healthy.goal!.target = 10;
    healthy.totalScore = 9;
    expect(endTurn(healthy, config).state.artifacts).toContain('standIn');
  });
});
