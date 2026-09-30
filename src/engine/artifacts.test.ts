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
  it('共 6 件，虹彩原石不进开局池，累加触发的 2 件', () => {
    const all = Object.values(ARTIFACTS);
    expect(all).toHaveLength(6);
    expect(all.filter((a) => a.every).map((a) => a.name)).toEqual(['引信匣', '余震核心']);
    expect(all.filter((a) => !a.starter).map((a) => a.name)).toEqual(['虹彩原石']);
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
  it('连锁透镜：P≥3 时倍率提高一档', () => {
    const s = battle(['chainLens'], { '2,0': 'a', '3,0': 'a', '4,0': 'H', '5,0': 'a' });
    const { log } = act(s, igniteRow4);
    const P = log.result.passiveClearCount;
    expect(P).toBeGreaterThanOrEqual(3);
    expect(log.settlement!.multiplier).toBe(multiplierFor(P, DEFAULT_CONFIG, 1));
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


describe('累加触发类神器', () => {
  it('引信匣：引爆数达到门槛时本回合 +1 AP，每回合最多一次，多余进度保留', () => {
    const s = battle(['fuseBox'], { '4,0': 'H', '4,5': 'V' });
    s.player.counters = { fuseBox: 14 };
    const first = act(s, igniteRow4);
    expect(first.log.counterTriggers).toEqual([{ key: 'fuseBox', ap: 1 }]);
    expect(first.state.ap).toBe(3);
    expect(first.state.player.counters!.fuseBox).toBe(1);
    // 同一回合再次达到门槛也不触发
    const again = first.state;
    again.player.counters = { fuseBox: 20 };
    again.board = boardWith({ '4,0': 'H' });
    const second = act(again, igniteRow4);
    expect(second.log.counterTriggers).toEqual([]);
    expect(second.state.player.counters!.fuseBox).toBe(21);
    // 下一回合的行动触发
    const next = endTurn(second.state).state;
    next.board = boardWith({ '4,0': 'H' });
    expect(act(next, igniteRow4).log.counterTriggers).toEqual([{ key: 'fuseBox', ap: 1 }]);
  });

  it('余震核心：被动清除累计到门槛时把一个普通方块变成 3×3 炸弹；进度跨战斗保留在玩家状态里', () => {
    const s = battle(['aftershockCore'], { '2,0': 'a', '3,0': 'a', '4,0': 'H', '5,0': 'a' });
    s.player.counters = { aftershockCore: 199 };
    const { state, log } = act(s, igniteRow4);
    const trig = log.counterTriggers[0]!;
    expect(trig.key).toBe('aftershockCore');
    const at = trig.key === 'aftershockCore' ? trig.at! : null;
    expect(state.board[at!.r]![at!.c]).toMatchObject({ kind: 'bomb', bomb: 'A' });
    expect(state.player.counters!.aftershockCore).toBe(199 + log.result.passiveClearCount - 200);
  });
});

describe('回合开始类神器', () => {
  it('火药桶：开战与每个新回合开始时，随机一个普通方块变成 3×3 炸弹', () => {
    const s = startBattle({ seed: 7, player: { hp: 40, maxHp: 40, shield: 0, catalystCharges: 0 }, enemy: { id: 'dummy', name: '木桩', maxHp: 500, script: [attack(1)], fallbackDefend: 3 }, artifacts: ['powderKeg'] });
    expect(s.board.flat().filter((t) => t?.kind === 'bomb')).toEqual([expect.objectContaining({ bomb: 'A' })]);
    const { state, log } = endTurn(s);
    expect(log!.turnStartBombs).toHaveLength(1);
    const at = log!.turnStartBombs![0]!;
    expect(state.board[at.r]![at.c]).toMatchObject({ kind: 'bomb', bomb: 'A' });
  });
});
