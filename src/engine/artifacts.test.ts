import { describe, expect, it } from 'vitest';
import { ARTIFACTS, type ArtifactKey } from './artifacts';
import { endTurn, playerAction, poisonThreshold, startBattle, type BattleState, type Intent } from './battle';
import { DEFAULT_CONFIG } from './config';
import { resolveAction } from './resolve';
import { multiplierFor } from './score';
import { boardWith, ins, randomCtx, testCtx } from './test-utils';
import type { Action } from './types';

const attack = (amount: number): Intent => ({ parts: [{ kind: 'attack', amount }] });

function battle(artifacts: ArtifactKey[], board: Record<string, string> = {}, inserts: ReturnType<typeof ins>[] = [], script = [attack(5)]): BattleState {
  const s = startBattle({
    seed: 7,
    player: { hp: 40, maxHp: 40, shield: 0, catalystCharges: 0 },
    enemy: { id: 'dummy', name: '木桩', maxHp: 500, script, fallbackDefend: 3 },
    inserts,
    artifacts,
  });
  s.board = boardWith(board);
  return s;
}

function act(s: BattleState, action: Action) {
  const out = playerAction(s, action);
  if (!out.ok) throw new Error(`行动无效：${out.reason}`);
  return out;
}

const igniteRow4: Action = { type: 'ignite', at: { r: 4, c: 0 } };

describe('神器池', () => {
  it('共 17 件（2 件依赖嵌片已下架），开局池 7 件，带代价的 2 件', () => {
    const all = Object.values(ARTIFACTS);
    expect(all).toHaveLength(17);
    expect(all.filter((a) => a.retired).map((a) => a.name)).toEqual(['共振底座', '锁位共鸣器']);
    expect(all.filter((a) => a.starter).map((a) => a.name)).toEqual(['密封毒瓶', '反应线圈', '连锁透镜', '回响钟', '藏宝图残页', '纯粹结晶', '爆破手册']);
    expect(all.filter((a) => a.cost).map((a) => a.name)).toEqual(['过载引线', '不稳定引信']);
    expect(all.some((a) => a.starter && a.cost)).toBe(false);
  });
});

describe('倍率修正顺序', () => {
  it('神器档位先封顶，再结算倍率侵蚀', () => {
    // P=70 已是封顶的 ×6；连锁透镜 +1 仍封顶 ×6，侵蚀再降一档为 ×5
    expect(multiplierFor(70, DEFAULT_CONFIG, 1, 1)).toBe(5);
    // 段内的小数保留：P=11 为 ×2.5，透镜 +1 为 ×3.5，侵蚀后 ×2.5
    expect(multiplierFor(11, DEFAULT_CONFIG, 1, 1)).toBe(2.5);
    expect(multiplierFor(0, DEFAULT_CONFIG, 0, 1)).toBe(1);
  });
});

describe('战斗中的神器', () => {
  it('穿甲针：每点攻击削减 2 点护盾', () => {
    const s = battle(['piercingNeedle'], { '4,0': 'H', '4,1': 'a', '4,2': 'a' });
    s.enemy.shield = 500;
    const { log } = act(s, igniteRow4);
    expect(log.damageToEnemyShield).toBe(2 * log.settlement!.finalEffects.attack);
    expect(log.damageToEnemyHp).toBe(0);
  });

  it('穿甲针：护盾被击穿后，剩余攻击按原值扣生命', () => {
    const s = battle(['piercingNeedle'], { '4,0': 'H', '4,1': 'a', '4,2': 'a' });
    s.enemy.shield = 3;
    const { log } = act(s, igniteRow4);
    const atk = log.settlement!.finalEffects.attack;
    expect(atk).toBeGreaterThanOrEqual(2);
    expect(log.damageToEnemyShield).toBe(3);
    expect(log.damageToEnemyHp).toBe(atk - 2); // 3 点护盾只需 ceil(3/2)=2 点攻击
  });

  it('密封毒瓶：眩晕后保留三分之一阈值的进度', () => {
    const s = battle(['sealedVial'], { '4,0': 'H' });
    const threshold = poisonThreshold(s.enemy.def.maxHp);
    s.enemy.poison = threshold - 1;
    const { state, log } = act(s, igniteRow4);
    expect(log.stunApplied).toBe(true);
    expect(state.enemy.poison).toBe(Math.floor(threshold / 3));
  });

  it('过载引线：单枚直线炸弹清三行，当步护盾为 0；组合技不受影响', () => {
    const s = battle(['overloadFuse'], { '4,0': 'H', '3,2': 's', '5,4': 's' });
    const { log } = act(s, igniteRow4);
    const first = log.result.events.find((e) => e.type === 'wave');
    expect(first && first.type === 'wave' && first.explosions[0]!.cells).toHaveLength(24);
    expect(log.result.overloadFired).toBe(true);
    expect(log.settlement!.baseValues.shield).toBeGreaterThan(0);
    expect(log.settlement!.finalEffects.shield).toBe(0);

    const combo = battle(['overloadFuse'], { '3,3': 'H', '3,4': 'V' });
    const out = act(combo, { type: 'swap', from: { r: 3, c: 3 }, to: { r: 3, c: 4 } });
    expect(out.log.result.overloadFired).toBe(false);
  });

  it('不稳定引信：主动引爆的炸弹计入 P', () => {
    const s = battle(['unstableFuse'], { '4,0': 'H', '4,5': 'V' });
    const { log } = act(s, igniteRow4);
    expect(log.result.activeBombsDetonated).toBe(2);
    expect(log.settlement!.multiplier).toBe(multiplierFor(log.result.passiveClearCount + 2, DEFAULT_CONFIG));
  });

  it('不稳定引信：回合结束时每枚留存炸弹伤害自己 1 点，先扣护盾', () => {
    const s = battle(['unstableFuse'], { '0,0': 'H', '0,2': 'A', '7,7': 'B' }, [], [{ parts: [{ kind: 'defend', amount: 1 }] }]);
    s.player.shield = 1;
    const { state, log } = endTurn(s);
    expect(log!.fuseDamageToShield).toBe(1);
    expect(log!.fuseDamageToHp).toBe(2);
    expect(state.player.hp).toBe(38);
  });

  it('共振底座：同一步两块不同嵌片有效触发时倍率提高一档', () => {
    const inserts = [ins('blade', 'blade', [4, 1], [4, 2], [3, 1], [3, 2]), ins('powder', 'blastPowder', [4, 6], [4, 7], [5, 6], [5, 7])];
    const s = battle(['resonanceBase'], { '4,0': 'H', '4,1': 'a' }, inserts);
    const { log } = act(s, igniteRow4);
    expect(log.result.triggeredInsertIds).toEqual(['blade', 'powder']);
    expect(log.settlement!.multiplier).toBe(multiplierFor(log.result.passiveClearCount, DEFAULT_CONFIG, 1));
  });

  it('连锁透镜：P≥3 时倍率提高一档', () => {
    const s = battle(['chainLens'], { '2,0': 'a', '3,0': 'a', '4,0': 'H', '5,0': 'a' });
    const { log } = act(s, igniteRow4);
    const P = log.result.passiveClearCount;
    expect(P).toBeGreaterThanOrEqual(3);
    expect(log.settlement!.multiplier).toBe(multiplierFor(P, DEFAULT_CONFIG, 1));
  });

  it('反应线圈：护盾完全挡下攻击时反击 2 点', () => {
    const s = battle(['reactionCoil'], {}, [], [attack(5)]);
    s.player.shield = 10;
    const { state, log } = endTurn(s);
    expect(log!.counterDamage).toBe(2);
    expect(state.enemy.hp).toBe(498);
  });

  it('反应线圈：护盾没有完全挡下时不反击', () => {
    const s = battle(['reactionCoil'], {}, [], [attack(5)]);
    s.player.shield = 3;
    expect(endTurn(s).log!.counterDamage).toBe(0);
  });

  it('回响钟：眩晕取消意图后，下一回合多 1 AP，再下一回合恢复', () => {
    const s = battle(['echoBell']);
    s.enemy.stunPending = true;
    const first = endTurn(s);
    expect(first.log!.apBonusNext).toBe(1);
    expect(first.state.ap).toBe(4);
    expect(endTurn(first.state).state.ap).toBe(3);
  });
});

describe('锁位共鸣器', () => {
  // A 被横向爆炸直接波及；B 与 A 有边相接；C 只与 B 相接
  const A = ins('A', 'blastPowder', [4, 6], [4, 7], [5, 6], [5, 7]);
  const B = ins('B', 'blastPowder', [6, 6], [6, 7], [7, 6], [7, 7]);
  const C = ins('C', 'blastPowder', [6, 4], [6, 5], [7, 4], [7, 5]);
  const run = (artifacts: ArtifactKey[]) =>
    resolveAction(boardWith({ '4,0': 'H' }), { type: 'ignite', at: { r: 4, c: 0 } }, { ...testCtx(1, undefined, [A, B, C]), artifacts });

  it('相邻嵌片一同被引动，只传一层', () => {
    expect(run(['lockResonator']).triggeredInsertIds).toEqual(['A', 'B']);
  });

  it('没有神器时只有直接被波及的嵌片触发', () => {
    expect(run([]).triggeredInsertIds).toEqual(['A']);
  });
});

describe('条件基数类神器', () => {
  // 横向炸弹炸掉第 0 行：含攻击、护盾与填充的毒气／催化剂，四种颜色都有
  const rowBoard = { '0,0': 'H', '0,1': 'a', '0,2': 's' };
  const igniteRow0: Action = { type: 'ignite', at: { r: 0, c: 0 } };

  it('纯粹结晶：只清一种颜色时该色 +3；清到多种颜色时不触发', () => {
    const single = act(battle(['pureCrystal'], { '0,0': 'a', '0,1': 'a', '0,2': 's', '1,2': 'a' }), { type: 'swap', from: { r: 1, c: 2 }, to: { r: 0, c: 2 } });
    expect(single.log.artifactBaseBonus).toEqual({ attack: 3, shield: 0, poison: 0, catalyst: 0 });
    expect(single.log.settlement!.baseValues.attack).toBe(3 + 3);
    const mixed = act(battle(['pureCrystal'], rowBoard), igniteRow0);
    expect(mixed.log.artifactBaseBonus).toEqual({ attack: 0, shield: 0, poison: 0, catalyst: 0 });
  });

  it('四色棱镜：四种颜色都清到时每种 +2', () => {
    const out = act(battle(['fourPrism'], rowBoard), igniteRow0);
    expect(out.log.artifactBaseBonus).toEqual({ attack: 2, shield: 2, poison: 2, catalyst: 2 });
  });

  it('爆破手册：亲手每做出一枚炸弹，该组颜色 +2', () => {
    const board = { '1,2': 's', '2,2': 's', '3,2': 'a', '4,2': 's', '1,3': 'a', '2,3': 'a', '3,3': 's', '4,3': 'a' };
    const out = act(battle(['blastManual'], board), { type: 'swap', from: { r: 3, c: 2 }, to: { r: 3, c: 3 } });
    expect(out.log.artifactBaseBonus).toMatchObject({ attack: 2, shield: 2 });
  });

  it('清场号角：主动清除不足 10 格不触发，达到 10 格时攻击、护盾、毒气各 +1', () => {
    const few = act(battle(['sweepHorn'], rowBoard), igniteRow0);
    expect(few.log.artifactBaseBonus).toEqual({ attack: 0, shield: 0, poison: 0, catalyst: 0 });
    // 横向炸弹波及第 5 列的竖向炸弹，一行加一列共 14 个方块
    const many = act(battle(['sweepHorn'], { ...rowBoard, '0,5': 'V' }), igniteRow0);
    expect(many.log.artifactBaseBonus).toEqual({ attack: 1, shield: 1, poison: 1, catalyst: 0 });
  });
});

describe('雷鸣引线', () => {
  const lightning = (seed: number) => {
    const ctx = { ...randomCtx(seed), artifacts: ['thunderFuse' as const] };
    const res = resolveAction(boardWith({ '4,0': 'H' }), igniteRow4, ctx);
    const wave = res.events.find((e) => e.type === 'wave')!;
    if (wave.type !== 'wave') throw new Error('缺少波次');
    return wave.explosions.find((e) => e.shape === 'lightning')!;
  };

  it('直线炸弹爆炸时追加 5–8 格闪电，都在直线两侧 2 行内、不在直线上', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const e = lightning(seed);
      expect(e.cells.length).toBeGreaterThanOrEqual(5);
      expect(e.cells.length).toBeLessThanOrEqual(8);
      for (const p of e.cells) expect([2, 3, 5, 6]).toContain(p.r);
    }
  });

  it('落点错落：彼此不上下左右相邻；同一种子结果相同', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const cells = lightning(seed).cells;
      for (const p of cells) for (const q of cells) if (p !== q) expect(Math.abs(p.r - q.r) + Math.abs(p.c - q.c)).toBeGreaterThan(1);
    }
    expect(lightning(3)).toEqual(lightning(3));
  });

  it('没有雷鸣引线时直线炸弹不带闪电', () => {
    const res = resolveAction(boardWith({ '4,0': 'H' }), igniteRow4, testCtx());
    expect(res.events.some((e) => e.type === 'wave' && e.explosions.some((x) => x.shape === 'lightning'))).toBe(false);
  });
});

