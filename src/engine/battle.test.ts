import { describe, expect, it } from 'vitest';
import { endTurn, playerAction, playerShieldCap, poisonDecay, poisonThreshold, startBattle, type BattleState, type EnemyDef, type Intent } from './battle';
import { DEFAULT_CONFIG } from './config';
import { defaultLevels } from './upgrades';
import { findLines } from './match';
import { multiplierFor } from './score';
import { boardWith, ins } from './test-utils';
import type { Action } from './types';

const player = () => ({ hp: 40, maxHp: 40, shield: 0, catalystCharges: 0 });
const enemy = (script: Intent[], maxHp = 50): EnemyDef => ({ id: 'mole', name: '晶背鼹鼠', maxHp, script, fallbackDefend: 5 });
const attack = (amount: number): Intent => ({ parts: [{ kind: 'attack', amount }] });

function battle(script: Intent[], opts: { maxHp?: number; board?: Record<string, string>; inserts?: ReturnType<typeof ins>[] } = {}): BattleState {
  const s = startBattle({ seed: 7, player: player(), enemy: enemy(script, opts.maxHp), inserts: opts.inserts ?? [] });
  s.board = boardWith(opts.board ?? {});
  return s;
}

function act(s: BattleState, action: Action) {
  const out = playerAction(s, action);
  if (!out.ok) throw new Error(`行动无效：${out.reason}`);
  return out;
}

const ignite = (r: number, c: number): Action => ({ type: 'ignite', at: { r, c } });
/** 填充棋盘上交换 (0,0)(0,1)：不形成匹配，是无效行动 */
const idleSwap: Action = { type: 'swap', from: { r: 0, c: 0 }, to: { r: 0, c: 1 } };

describe('战斗开始', () => {
  it('3 AP、展示第一次意图、棋盘无初始匹配；同种子状态完全相同', () => {
    const a = startBattle({ seed: 3, player: player(), enemy: enemy([attack(5)]) });
    const b = startBattle({ seed: 3, player: player(), enemy: enemy([attack(5)]) });
    expect(a.ap).toBe(3);
    expect(a.enemy.intent).toEqual(attack(5));
    expect(findLines(a.board)).toHaveLength(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('玩家行动', () => {
  it('结算效果施加到敌我：伤害、护盾、毒气与结算明细一致，扣 1 AP', () => {
    const s = battle([attack(5)], { board: { '4,0': 'H', '4,1': 'a', '4,2': 'a' } });
    const { state, log } = act(s, ignite(4, 0));
    const fx = log.settlement!.finalEffects;
    expect(fx.attack).toBeGreaterThan(0);
    expect(log.damageToEnemyHp).toBe(fx.attack);
    expect(state.enemy.hp).toBe(50 - fx.attack);
    expect(state.player.shield).toBe(fx.shield);
    expect(state.enemy.poison).toBe(fx.poison);
    expect(state.ap).toBe(2);
    expect(state.totalScore).toBe(log.settlement!.settlementScore);
  });

  it('攻击先扣敌人护盾', () => {
    const s = battle([attack(5)], { board: { '4,0': 'H', '4,1': 'a' } });
    s.enemy.shield = 100;
    const { state, log } = act(s, ignite(4, 0));
    expect(log.damageToEnemyShield).toBe(log.settlement!.finalEffects.attack);
    expect(state.enemy.hp).toBe(50);
  });

  it('不能消除的交换无效、不耗 AP；AP 用完后不能再行动', () => {
    const s = battle([attack(5)]);
    expect(playerAction(s, idleSwap)).toMatchObject({ ok: false, reason: 'noMatch', state: { ap: 3 } });
    s.ap = 0;
    expect(playerAction(s, ignite(0, 0))).toMatchObject({ ok: false, reason: 'noAp' });
  });

  it('击杀立即结束战斗，敌人不再行动', () => {
    const s = battle([attack(99)], { maxHp: 1, board: { '4,0': 'H', '4,1': 'a' } });
    const { state } = act(s, ignite(4, 0));
    expect(state.outcome).toBe('won');
    expect(playerAction(state, idleSwap)).toMatchObject({ ok: false, reason: 'battleOver' });
    expect(endTurn(state).log).toBeNull();
  });

  it('催化剂充能跨回合保留，被下一次主动清除有色方块的行动消耗', () => {
    let s = battle([attack(5)], { board: { '4,0': 'H' } });
    s.player.catalystCharges = 1;
    s = endTurn(s).state;
    expect(s.player.catalystCharges).toBe(1);
    const { log } = act(s, ignite(4, 0));
    expect(log.settlement!.chargesUsed).toBe(1);
  });
});

describe('敌人回合', () => {
  it('攻击先扣护盾再扣生命；AP 恢复、回合数增加、展示下一意图', () => {
    const s = battle([attack(5), attack(7)]);
    s.player.shield = 3;
    s.ap = 0;
    const { state, log } = endTurn(s);
    expect(log!.damageToPlayerShield).toBe(3);
    expect(log!.damageToPlayerHp).toBe(2);
    expect(state.player.hp).toBe(38);
    expect(state.ap).toBe(3);
    expect(state.turn).toBe(2);
    expect(state.enemy.intent).toEqual(attack(7));
  });

  it('护盾挡完攻击后，剩余部分在敌人回合结束时清空（playerShieldRetain = 0）', () => {
    const s = battle([attack(5), attack(7)]);
    s.player.shield = 12;
    s.ap = 0;
    const { state, log } = endTurn(s);
    expect(log!.damageToPlayerShield).toBe(5);
    expect(state.player.hp).toBe(40);
    expect(state.player.shield).toBe(0);
    // 保留比例为 1 时恢复旧规则：剩余护盾跨回合保留
    const kept = endTurn({ ...s, player: { ...s.player, shield: 12 } }, { ...DEFAULT_CONFIG, playerShieldRetain: 1 });
    expect(kept.state.player.shield).toBe(7);
  });

  it('蓄力加到下一次攻击上；防御增加敌人护盾', () => {
    let s = battle([{ parts: [{ kind: 'charge', amount: 4 }] }, { parts: [{ kind: 'defend', amount: 6 }, { kind: 'attack', amount: 5 }] }]);
    s = endTurn(s).state;
    const { state, log } = endTurn(s);
    expect(log!.damageToPlayerHp).toBe(9);
    expect(state.enemy.shield).toBe(6);
    expect(state.enemy.chargeBonus).toBe(0);
  });

  it('攻击被眩晕取消时，蓄力加成作废', () => {
    let s = battle([{ parts: [{ kind: 'charge', amount: 6 }] }, attack(6), attack(4)]);
    s = endTurn(s).state;
    expect(s.enemy.chargeBonus).toBe(6);
    s.enemy.stunPending = true;
    const cancelled = endTurn(s);
    expect(cancelled.log!.cancelledByStun).toBe(true);
    expect(cancelled.state.enemy.chargeBonus).toBe(0);
    expect(endTurn(cancelled.state).log!.damageToPlayerHp).toBe(4);
  });

  it('生命归零立即失败', () => {
    const s = battle([attack(10)]);
    s.player.hp = 3;
    const { state } = endTurn(s);
    expect(state.outcome).toBe('lost');
    expect(state.player.hp).toBe(0);
  });
});

describe('毒气与眩晕', () => {
  it('达到阈值挂上眩晕并归零；本回合之后的毒气不再积累；眩晕取消整次意图', () => {
    let s = battle([attack(20)], { board: { '4,0': 'H' } });
    s.enemy.poison = poisonThreshold(s.enemy.def.maxHp) - 1;
    const first = act(s, ignite(4, 0));
    expect(first.log.stunApplied).toBe(true);
    s = first.state;
    expect(s.enemy.poison).toBe(0);
    // 再放一枚炸弹，本回合的新毒气不积累
    s.board[7]![7] = { id: 9_999, kind: 'bomb', bomb: 'V' };
    const second = act(s, ignite(7, 7));
    expect(second.log.settlement!.finalEffects.poison).toBeGreaterThan(0);
    expect(second.log.poisonAdded).toBe(0);
    const { state, log } = endTurn(second.state);
    expect(log!.cancelledByStun).toBe(true);
    expect(state.player.hp).toBe(40);
    expect(state.enemy.stunPending).toBe(false);
  });

  it('敌人回合末毒气衰减，被眩晕跳过意图的回合也衰减', () => {
    const s = battle([attack(1)]);
    s.enemy.poison = 5;
    s.enemy.stunPending = true;
    const { state, log } = endTurn(s);
    expect(log!.cancelledByStun).toBe(true);
    expect(state.enemy.poison).toBe(5 - poisonDecay(s.enemy.def.maxHp));
  });
});

describe('特殊意图', () => {
  it('倍率侵蚀：下一回合首次主动清除的倍率降一档，之后恢复', () => {
    let s = battle([{ parts: [{ kind: 'erodeMultiplier' }] }, attack(1)], { board: { '4,0': 'H', '6,0': 'V' } });
    s = endTurn(s).state;
    expect(s.current.erosionArmed).toBe(true);
    s.board = boardWith({ '4,0': 'H', '7,7': 'V' });
    const first = act(s, ignite(4, 0));
    expect(first.log.erosionConsumed).toBe(true);
    expect(first.log.settlement!.multiplier).toBe(multiplierFor(first.log.result.passiveClearCount, DEFAULT_CONFIG, 0, 1));
    expect(first.state.current.erosionArmed).toBe(false);
  });

  it('倍率侵蚀：整回合没有主动消除时，在回合结束时消失', () => {
    let s = battle([{ parts: [{ kind: 'erodeMultiplier' }] }, attack(1)]);
    s = endTurn(s).state;
    expect(s.current.erosionArmed).toBe(true);
    expect(endTurn(s).state.current.erosionArmed).toBe(false);
  });

  it('嵌片压制：展示时固定目标，下一玩家回合该嵌片失效，回合结束后恢复', () => {
    const powder = ins('p1', 'blastPowder', [4, 6], [4, 7], [5, 6], [5, 7]);
    let s = battle([{ parts: [{ kind: 'suppressInsert' }] }, attack(1)], { inserts: [powder] });
    expect(s.enemy.intent.parts[0]).toEqual({ kind: 'suppressInsert', targetId: 'p1' });
    s = endTurn(s).state;
    expect(s.current.suppressedId).toBe('p1');
    s.board = boardWith({ '4,0': 'H' });
    expect(act(s, ignite(4, 0)).log.result.triggeredInsertIds).toEqual([]);
    s = endTurn(s).state;
    expect(s.current.suppressedId).toBeNull();
    s.board = boardWith({ '4,0': 'H' });
    expect(act(s, ignite(4, 0)).log.result.triggeredInsertIds).toEqual(['p1']);
  });

  it('嵌片压制：没有已安装嵌片时改用防御', () => {
    const s = battle([{ parts: [{ kind: 'suppressInsert' }] }]);
    expect(s.enemy.intent).toEqual({ parts: [{ kind: 'defend', amount: 5 }] });
  });

  it('重力反转：下一玩家回合起向上 3 回合，提前结束也扣减；生效期间不再选重力意图', () => {
    const gravity: Intent = { parts: [{ kind: 'gravityUp' }] };
    let s = battle([gravity, attack(1), gravity, attack(2)]);
    s = endTurn(s).state; // 施加
    expect(s.gravity).toBe('up');
    expect(s.gravityTurnsLeft).toBe(3);
    expect(s.enemy.intent).toEqual(attack(1));
    s.board = boardWith({ '4,0': 'H' });
    const up = act(s, ignite(4, 0));
    expect(up.log.result.events.find((e) => e.type === 'gravity')).toMatchObject({ gravity: 'up' });
    s = endTurn(s).state; // 第 1 个受影响回合结束
    expect(s.enemy.intent).toEqual(attack(2)); // 跳过了脚本里的重力意图
    s = endTurn(s).state;
    expect(s.gravity).toBe('up');
    s = endTurn(s).state; // 第 3 个受影响回合结束
    expect(s.gravity).toBe('down');
    expect(s.gravityTurnsLeft).toBe(0);
  });

  it('重力反转：被眩晕取消时不施加', () => {
    const s = battle([{ parts: [{ kind: 'gravityUp' }] }, attack(1)]);
    s.enemy.stunPending = true;
    const { state } = endTurn(s);
    expect(state.gravity).toBe('down');
    expect(state.pending.gravity).toBe(false);
  });
});

describe('可复现', () => {
  it('同种子、同样的行动序列得到完全相同的状态', () => {
    const run = () => {
      let s = startBattle({ seed: 11, player: player(), enemy: enemy([attack(3), { parts: [{ kind: 'defend', amount: 4 }] }]) });
      for (let turn = 0; turn < 5; turn++) {
        for (let i = 0; i < 3; i++) {
          const out = playerAction(s, { type: 'swap', from: { r: i + turn, c: 2 }, to: { r: i + turn, c: 3 } });
          if (out.ok) s = out.state;
        }
        s = endTurn(s).state;
      }
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });
});

describe('石块', () => {
  it('不能交换；被主动爆炸清除时不计基数', () => {
    const s = battle([attack(1)], { board: { '0,0': 'X', '4,0': 'H', '4,1': 'X', '4,2': 'a' } });
    expect(playerAction(s, { type: 'swap', from: { r: 0, c: 0 }, to: { r: 0, c: 1 } })).toMatchObject({ ok: false, reason: 'stone' });
    const out = act(s, ignite(4, 0));
    const wave = out.log.result.events.find((e) => e.type === 'wave');
    if (wave?.type !== 'wave') throw new Error('缺少波次');
    expect(wave.cleared.some((c) => c.tile.kind === 'stone')).toBe(true);
    // 第 4 行只有一个攻击方块，石块不增加任何基数
    expect(out.log.result.activeClearsByType.attack).toBe(1);
  });
});

describe('色封', () => {
  const seal: Intent = { parts: [{ kind: 'sealColor' }, { kind: 'attack', amount: 3 }] };

  it('展示时封住等级最高的颜色；四色都是 1 级时改为防御', () => {
    const s = startBattle({ seed: 7, player: player(), enemy: enemy([seal]), levels: { attack: 1, shield: 3, poison: 2, catalyst: 1, line: 1, area: 1, color: 1 } });
    expect(s.enemy.intent.parts[0]).toEqual({ kind: 'sealColor', color: 'shield' });
    const plain = startBattle({ seed: 7, player: player(), enemy: enemy([seal]) });
    expect(plain.enemy.intent.parts[0]).toEqual({ kind: 'defend', amount: 5 });
  });

  it('生效的回合里被封颜色每块只计 1；未被眩晕时才生效，回合后恢复', () => {
    const s = startBattle({ seed: 7, player: player(), enemy: enemy([seal, attack(1)], 500), levels: { attack: 3, shield: 1, poison: 1, catalyst: 1, line: 1, area: 1, color: 1 } });
    s.ap = 0;
    const sealed = endTurn(s).state;
    expect(sealed.current.sealedColor).toBe('attack');
    sealed.board = boardWith({ '0,0': 'a', '0,1': 'a', '0,2': 's', '1,2': 'a' });
    const hit = act(sealed, { type: 'swap', from: { r: 1, c: 2 }, to: { r: 0, c: 2 } });
    expect(hit.log.result.activeClearsByType.attack).toBe(3);
    hit.state.ap = 0;
    expect(endTurn(hit.state).state.current.sealedColor).toBeNull();
  });
});

describe('石化', () => {
  const petrify: Intent = { parts: [{ kind: 'petrify', count: 3 }] };

  it('展示时固定目标行，敌人行动时把该行 3 个普通方块变成石块', () => {
    // 不替换棋盘：目标行按开战时的棋盘选定
    const s = startBattle({ seed: 7, player: player(), enemy: enemy([petrify, attack(1)]) });
    const row = (s.enemy.intent.parts[0] as { row?: number }).row!;
    expect(row).toBeGreaterThanOrEqual(0);
    s.ap = 0;
    const { state, log } = endTurn(s);
    expect(log!.petrified).toHaveLength(3);
    expect(log!.petrified.every((p) => p.r === row)).toBe(true);
    expect(state.board[row]!.filter((t) => t?.kind === 'stone')).toHaveLength(3);
  });

  it('棋盘石块达到上限时，石化改为防御；执行时也不超过上限', () => {
    const stones: Record<string, string> = {};
    for (let c = 0; c < 8; c++) stones[`7,${c}`] = 'X';
    stones['6,0'] = 'X';
    const s = battle([petrify, petrify], { board: stones });
    s.enemy.intent = { parts: [{ kind: 'petrify', count: 3, row: 6 }] };
    s.ap = 0;
    // 已有 9 块、上限 10：本次最多再石化 1 块
    const first = endTurn(s);
    expect(first.log!.petrified).toHaveLength(1);
    expect(first.state.enemy.intent.parts[0]).toEqual({ kind: 'defend', amount: 5 });
  });

  it('被眩晕取消时不石化', () => {
    const s = battle([petrify, attack(1)]);
    s.enemy.stunPending = true;
    s.ap = 0;
    const { state, log } = endTurn(s);
    expect(log!.petrified).toHaveLength(0);
    expect(state.board.flat().some((t) => t?.kind === 'stone')).toBe(false);
  });
});


describe('碎甲、穿刺、强化', () => {
  it('碎甲：下一玩家回合护盾上限减半，回合结束后恢复', () => {
    let s = battle([{ parts: [{ kind: 'shatter' }] }, attack(1)], { board: { '4,0': 'H', '4,2': 's', '4,4': 's', '4,6': 's' } });
    s = endTurn(s).state;
    expect(s.current.shattered).toBe(true);
    expect(playerShieldCap(s)).toBe(20);
    s.board = boardWith({ '4,0': 'H', '4,2': 's', '4,4': 's', '4,6': 's' });
    s.player.shield = 19;
    s = act(s, ignite(4, 0)).state;
    expect(s.player.shield).toBe(20);
    s = endTurn(s).state;
    expect(s.current.shattered).toBe(false);
    expect(playerShieldCap(s)).toBe(40);
  });

  it('穿刺：一半伤害无视护盾', () => {
    const s = battle([{ parts: [{ kind: 'attack', amount: 20, pierce: true }] }]);
    s.player.shield = 40;
    const { state, log } = endTurn(s);
    expect(log!.damageToPlayerHp).toBe(10);
    expect(log!.damageToPlayerShield).toBe(10);
    expect(state.player.hp).toBe(30);
  });

  it('强化：此后每次攻击永久加成并可叠加，眩晕不清除', () => {
    let s = battle([{ parts: [{ kind: 'empower', amount: 4 }] }, attack(10)]);
    s = endTurn(s).state;
    expect(s.enemy.strength).toBe(4);
    const { state, log } = endTurn(s);
    expect(log!.damageToPlayerHp).toBe(14);
    expect(state.enemy.strength).toBe(4);
  });
});

describe('爆破等级', () => {
  it('每场从炸弹升级等级开始；引爆数达标后升一级，从下一次行动起生效', () => {
    const s0 = startBattle({ seed: 7, player: player(), enemy: enemy([attack(1)]), levels: { ...defaultLevels(), line: 2 } });
    expect(s0.bombHeat.line).toEqual({ level: 2, count: 0 });
    let s = battle([attack(1)], { board: { '4,0': 'H' } });
    s.bombHeat.line.count = DEFAULT_CONFIG.bombHeatEvery.line - 1;
    const out = act(s, ignite(4, 0));
    expect(out.log.bombLevelUps).toEqual(['line']);
    expect(out.state.bombHeat.line).toEqual({ level: 2, count: 0 });
    // 升级那一步本身仍按旧等级结算：第 4 行的方块没有额外基数
    expect(out.log.result.events.find((e) => e.type === 'wave' && e.explosions[0]!.blockBonus)).toBeUndefined();
    s = out.state;
    s.board = boardWith({ '4,0': 'H' });
    const next = act(s, ignite(4, 0));
    expect(next.log.result.events.find((e) => e.type === 'wave')).toMatchObject({ explosions: [expect.objectContaining({ blockBonus: 1 })] });
  });
});
