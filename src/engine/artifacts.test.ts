import { describe, expect, it } from 'vitest';
import { ARTIFACTS, type ArtifactKey } from './artifacts';
import { endTurn, playerAction, startBattle, type BattleState, type Intent } from './battle';
import { DEFAULT_CONFIG } from './config';
import { resolveAction } from './resolve';
import { multiplierFor } from './score';
import { boardWith, ins, testCtx } from './test-utils';
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
  it('首版 12 件，开局池 5 件，带代价的 2 件', () => {
    const all = Object.values(ARTIFACTS);
    expect(all).toHaveLength(12);
    expect(all.filter((a) => a.starter).map((a) => a.name)).toEqual(['密封毒瓶', '反应线圈', '连锁透镜', '回响钟', '藏宝图残页']);
    expect(all.filter((a) => a.cost).map((a) => a.name)).toEqual(['过载引线', '不稳定引信']);
    expect(all.some((a) => a.starter && a.cost)).toBe(false);
  });
});

describe('倍率修正顺序', () => {
  it('神器档位先封顶，再结算倍率侵蚀', () => {
    // P=9 已是 ×8；连锁透镜 +1 仍封顶 ×8，侵蚀再降一档为 ×4
    expect(multiplierFor(9, DEFAULT_CONFIG, 1, 1)).toBe(4);
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

  it('密封毒瓶：眩晕后保留 4 点进度', () => {
    const s = battle(['sealedVial'], { '4,0': 'H' });
    s.enemy.poison = 11;
    const { state, log } = act(s, igniteRow4);
    expect(log.stunApplied).toBe(true);
    expect(state.enemy.poison).toBe(4);
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
