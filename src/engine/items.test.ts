import { describe, expect, it } from 'vitest';
import { startBattle, useItem, type BattleState } from './battle';
import { DEFAULT_CONFIG } from './config';
import { CRYSTAL_MOLE } from './content/enemies';
import { ITEMS } from './items';
import { buyItem, leaveShop, newRun, pickStarter, runUseItem, startNextBattle, type RunResult, type RunState } from './run';
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

describe('道具效果', () => {
  it('锤子：砸掉一格照常计分；默认不耗步，打开开关后耗 1 步', () => {
    const s = battle({ '5,5': 'a' });
    const out = used(useItem(s, { key: 'hammer', at: { r: 5, c: 5 } }, config));
    expect(out.log!.result.activeClearsByType.attack).toBe(1);
    expect(out.state.totalScore).toBeGreaterThan(0);
    expect(out.state.ap).toBe(s.ap);
    expect(used(useItem(s, { key: 'hammer', at: { r: 5, c: 5 } }, { ...config, itemCostsStep: true })).state.ap).toBe(s.ap - 1);
  });

  it('锤子砸到炸弹就引爆它', () => {
    const out = used(useItem(battle({ '4,0': 'H' }), { key: 'hammer', at: { r: 4, c: 0 } }, config));
    expect(out.events.some((e) => e.type === 'wave' && e.explosions.some((x) => x.shape === 'H'))).toBe(true);
  });

  it('手套：不能消除的交换也换过去，不计分', () => {
    const s = battle({});
    const a = s.board[0]![0]!;
    const b = s.board[0]![1]!;
    const out = used(useItem(s, { key: 'glove', from: { r: 0, c: 0 }, to: { r: 0, c: 1 } }, config));
    expect(out.state.board[0]![0]!.id).toBe(b.id);
    expect(out.state.board[0]![1]!.id).toBe(a.id);
    expect(out.state.totalScore).toBe(0);
    expect(out.state.ap).toBe(s.ap);
  });

  it('雷管：引爆棋盘上所有炸弹；没有炸弹时不能用', () => {
    const out = used(useItem(battle({ '0,0': 'H', '7,7': 'V' }), { key: 'detonator' }, config));
    const shapes = out.events.flatMap((e) => (e.type === 'wave' ? e.explosions.map((x) => x.shape) : []));
    expect(shapes).toEqual(expect.arrayContaining(['H', 'V']));
    expect(out.state.totalScore).toBeGreaterThan(0);
    expect(useItem(battle({}), { key: 'detonator' }, config).ok).toBe(false);
  });

  it('炸药包：普通方块变成五连炸弹；对炸弹无效', () => {
    const s = battle({ '0,0': 'H' });
    const out = used(useItem(s, { key: 'charge', at: { r: 3, c: 3 } }, config));
    expect(out.state.board[3]![3]).toMatchObject({ kind: 'bomb', bomb: 'CB' });
    expect(useItem(s, { key: 'charge', at: { r: 0, c: 0 } }, config).ok).toBe(false);
  });

  it('洗牌：炸弹原地不动，普通方块重新排列', () => {
    const s = battle({ '0,0': 'H' });
    const out = used(useItem(s, { key: 'shuffle' }, config));
    expect(out.state.board[0]![0]!.id).toBe(s.board[0]![0]!.id);
    expect(out.events[0]!.type).toBe('shuffle');
  });

  it('本回合没有步可走时不能用', () => {
    const s = battle({});
    s.ap = 0;
    expect(useItem(s, { key: 'shuffle' }, config).ok).toBe(false);
  });
});

describe('商店里的道具', () => {
  const toShop = (gold: number): RunState => {
    let run = newRun(2, config);
    run = ok(startNextBattle(ok(pickStarter(run, run.starterChoices[0]!)), config));
    const r = JSON.parse(JSON.stringify(run)) as RunState;
    r.battle!.goal!.target = 1;
    r.battle!.board = boardWith({ '4,0': 'H', '4,1': 'a' });
    const won = ok(runUseItemFree(r));
    return { ...won, gold };
  };
  // 用锤子引爆炸弹过关，顺带检验关内道具能直接达标
  const runUseItemFree = (r: RunState) => runUseItem({ ...r, items: ['hammer'] }, 0, { key: 'hammer', at: { r: 4, c: 0 } }, config);

  it('用道具达标同样结算本关；每次随机上架 3 种不同的道具', () => {
    const shop = toShop(0);
    expect(shop.phase).toBe('shop');
    expect(shop.items).toEqual([]);
    expect(shop.shopItems).toHaveLength(config.itemsPerShop);
    expect(new Set(shop.shopItems).size).toBe(config.itemsPerShop);
  });

  it('买下：扣钱、放进背包、从货架拿走；背包满或钱不够时不能买', () => {
    const shop = toShop(100);
    const key = shop.shopItems[0]!;
    const bought = ok(buyItem(shop, 0, config));
    expect(bought.items).toEqual([key]);
    expect(bought.gold).toBe(100 - ITEMS[key].price);
    expect(bought.shopItems).not.toContain(key);
    expect(buyItem({ ...shop, items: ['hammer', 'hammer', 'hammer'] }, 0, config).ok).toBe(false);
    expect(buyItem({ ...shop, gold: 0 }, 0, config).ok).toBe(false);
    expect(ok(leaveShop(bought)).shopItems).toEqual([]);
  });
});
