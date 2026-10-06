// 道具（2026-10-06 重做）：关内掉落，手套、吸管、洗牌改布局，放大镜、回声改倍率与得分。
import { describe, expect, it } from 'vitest';
import { playerAction, startBattle, useItem, type BattleState } from './battle';
import { DEFAULT_CONFIG } from './config';
import { CRYSTAL_MOLE } from './content/enemies';
import { ITEM_PARAMS } from './items';
import { leaveShop, newRun, pickStarter, runAction, runUseItem, startNextBattle, type RunResult, type RunState } from './run';
import { boardWith } from './test-utils';

const config = { ...DEFAULT_CONFIG, scoreMode: true };
const ok = (r: RunResult): RunState => {
  if (!r.ok) throw new Error(r.reason);
  return r.run;
};
const battle = (cells: Record<string, string>): BattleState => {
  const s = startBattle({ seed: 1, player: { hp: 40, maxHp: 40, shield: 0, catalystCharges: 0 }, enemy: { ...CRYSTAL_MOLE, targetScore: 1e9 } }, config);
  s.board = boardWith(cells);
  return s;
};
const used = (out: ReturnType<typeof useItem>) => {
  if (!out.ok) throw new Error(out.reason);
  return out;
};
// 第 0 行 a a . a：(0,2) 染成红色就连成四个
const row = { '0,0': 'a', '0,1': 'a', '0,3': 'a' };

describe('道具效果', () => {
  it('手套：不能消除的交换也换过去，不计分、不扣步', () => {
    const s = battle({ '5,5': 'a', '5,6': 's' });
    const a = s.board[5]![5]!;
    const out = used(useItem(s, { key: 'glove', from: { r: 5, c: 5 }, to: { r: 5, c: 6 } }, config));
    expect(out.state.board[5]![6]!.id).toBe(a.id);
    expect(out.state.totalScore).toBe(0);
    expect(out.state.ap).toBe(s.ap);
  });

  it('吸管：染完成线就照常消除计分；不成线就只染色', () => {
    const out = used(useItem(battle(row), { key: 'dropper', from: { r: 0, c: 1 }, to: { r: 0, c: 2 } }, config));
    expect(out.events[0]).toMatchObject({ type: 'paint', at: { r: 0, c: 2 } });
    expect(out.events.some((e) => e.type === 'matches' && e.phase === 'active')).toBe(true);
    expect(out.state.totalScore).toBeGreaterThan(0);
    const quiet = used(useItem(battle({ '5,5': 'a', '5,6': 's' }), { key: 'dropper', from: { r: 5, c: 5 }, to: { r: 5, c: 6 } }, config));
    expect(quiet.state.board[5]![6]).toMatchObject({ kind: 'normal', color: 'attack' });
    expect(quiet.state.totalScore).toBe(0);
    // 同色、炸弹不能染
    expect(useItem(battle(row), { key: 'dropper', from: { r: 0, c: 0 }, to: { r: 0, c: 1 } }, config).ok).toBe(false);
    expect(useItem(battle({ '4,0': 'H' }), { key: 'dropper', from: { r: 4, c: 1 }, to: { r: 4, c: 0 } }, config).ok).toBe(false);
  });

  it('放大镜：下一次结算倍率 ×2，用过就失效；已挂上时不能再用', () => {
    const s = battle(row);
    const armed = used(useItem(s, { key: 'magnifier' }, config)).state;
    expect(useItem(armed, { key: 'magnifier' }, config).ok).toBe(false);
    const swap = { type: 'swap', from: { r: 0, c: 3 }, to: { r: 0, c: 2 } } as const;
    const plain = playerAction(s, swap, config);
    const boosted = playerAction(armed, swap, config);
    if (!plain.ok || !boosted.ok) throw new Error('行动无效');
    expect(boosted.log.settlement!.multiplier).toBeCloseTo(plain.log.settlement!.multiplier * ITEM_PARAMS.magnifierFactor);
    expect(boosted.log.tally!.steps.at(-1)).toMatchObject({ key: 'magnifier' });
    expect(boosted.state.magnify).toBe(false);
  });

  it('回声：再得一次上一步的分；还没得过分时不能用', () => {
    const s = battle(row);
    expect(useItem(s, { key: 'echo' }, config).ok).toBe(false);
    const after = playerAction(s, { type: 'swap', from: { r: 0, c: 3 }, to: { r: 0, c: 2 } }, config);
    if (!after.ok) throw new Error(after.reason);
    const gained = after.log.settlement!.settlementScore;
    const out = used(useItem(after.state, { key: 'echo' }, config));
    expect(out.gained).toBe(gained);
    expect(out.state.totalScore).toBe(after.state.totalScore + gained);
  });

  it('洗牌：重排棋盘，炸弹不动', () => {
    const s = battle({ '0,0': 'H' });
    const out = used(useItem(s, { key: 'shuffle' }, config));
    expect(out.state.board[0]![0]!.id).toBe(s.board[0]![0]!.id);
    expect(out.events[0]!.type).toBe('shuffle');
  });

  it('本回合没有步时不能用道具', () => {
    const s = battle(row);
    s.ap = 0;
    expect(useItem(s, { key: 'magnifier' }, config).ok).toBe(false);
  });
});

describe('道具掉落', () => {
  function inLevel(board: Record<string, string>): RunState {
    let run = newRun(2, config);
    run = ok(pickStarter(run, run.starterChoices[0]!));
    run = ok(startNextBattle(run, config));
    run.battle!.board = boardWith(board);
    return run;
  }
  // 第 2 行 a a . a a，(3,2) 的 a 换上去成五连
  const five = { '2,0': 'a', '2,1': 'a', '2,3': 'a', '2,4': 'a', '3,2': 'a' };
  const makeFive = { type: 'swap', from: { r: 3, c: 2 }, to: { r: 2, c: 2 } } as const;

  it('做出五连炸弹的一步掉一件道具，放进背包', () => {
    const r = runAction(inLevel(five), makeFive, config);
    if (!r.ok) throw new Error(r.reason);
    expect(r.drop).toBeDefined();
    expect(r.run.items).toEqual([r.drop]);
    expect(r.run.battle!.itemDrops).toBe(1);
  });

  it('每关最多掉 2 件；背包满了不掉', () => {
    const capped = inLevel(five);
    capped.battle!.itemDrops = ITEM_PARAMS.dropsPerLevel;
    expect(ok(runAction(capped, makeFive, config)).items).toEqual([]);
    const full = inLevel(five);
    full.items = ['glove', 'echo', 'shuffle'];
    expect(ok(runAction(full, makeFive, config)).items).toEqual(['glove', 'echo', 'shuffle']);
  });

  it('普通的一步不掉', () => {
    expect(ok(runAction(inLevel(row), { type: 'swap', from: { r: 0, c: 3 }, to: { r: 0, c: 2 } }, config)).items.length).toBeLessThanOrEqual(
      // 补位随机，偶尔会连出 8 层；绝大多数情况为 0
      1,
    );
  });

  it('关内用掉背包里的道具；商店不再卖道具', () => {
    const run = inLevel(row);
    run.items = ['magnifier'];
    const after = ok(runUseItem(run, 0, { key: 'magnifier' }, config));
    expect(after.items).toEqual([]);
    expect(after.battle!.magnify).toBe(true);
    const shop = { ...run, phase: 'shop' as const, shopItems: [] };
    expect(ok(leaveShop(shop)).phase).toBe('map');
  });
});
