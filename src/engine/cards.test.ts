import { describe, expect, it } from 'vitest';
import { endTurn, playerAction, startBattle, type BattleState, type Intent } from './battle';
import { drawCards, makeCard, starterDeck, type CardInstance } from './cards';
import { createRng } from './rng';
import { boardWith } from './test-utils';
import type { Pos } from './types';

const attack = (amount: number): Intent => ({ parts: [{ kind: 'attack', amount }] });

function cardBattle(deck: CardInstance[], board: Record<string, string> = {}): BattleState {
  const s = startBattle({
    seed: 3,
    player: { hp: 40, maxHp: 40, shield: 0, catalystCharges: 0 },
    enemy: { id: 'dummy', name: '木桩', maxHp: 500, script: [attack(3)], fallbackDefend: 3 },
    deck,
  });
  s.board = boardWith(board);
  return s;
}

const handIndex = (s: BattleState, defId: string) => s.cards!.hand.findIndex((c) => c.defId === defId);
const row = (r: number, c0: number, n: number): Pos[] => Array.from({ length: n }, (_, i) => ({ r, c: c0 + i }));

describe('嵌片卡：牌堆', () => {
  it('起始牌组 4 基础 + 1 属性；开战抽 5 张', () => {
    const s = cardBattle(starterDeck('blade'));
    expect(s.cards!.hand.map((c) => c.defId).sort()).toEqual(['basic-I', 'basic-L', 'basic-O', 'basic-T', 'blade']);
    expect(s.cards!.draw).toHaveLength(0);
    expect(s.ap).toBe(3);
  });

  it('回合结束手牌进弃牌堆；抽牌堆不足时把弃牌堆洗回', () => {
    const deck = [...starterDeck('blade'), makeCard('basic-S', 'x1'), makeCard('basic-S', 'x2')];
    const s = cardBattle(deck);
    expect(s.cards!.hand).toHaveLength(5);
    expect(s.cards!.draw).toHaveLength(2);
    const next = endTurn(s).state;
    expect(next.cards!.hand).toHaveLength(5);
    expect(next.cards!.draw.length + next.cards!.discard.length + next.cards!.hand.length).toBe(7);
  });

  it('手牌达到上限后多余的抽牌跳过', () => {
    const piles = { draw: Array.from({ length: 8 }, (_, i) => makeCard('basic-I', `d${i}`)), hand: [], discard: [] };
    drawCards(piles, 8, 6, createRng(1));
    expect(piles.hand).toHaveLength(6);
    expect(piles.draw).toHaveLength(2);
  });
});

describe('嵌片卡：打出', () => {
  it('打出卡片清除覆盖的格子，算主动清除，扣费用，卡进弃牌堆', () => {
    const s = cardBattle(starterDeck('blade'), { '4,0': 'a', '4,1': 'a', '4,2': 's', '4,3': 'p' });
    const out = playerAction(s, { type: 'playCard', index: handIndex(s, 'basic-I'), cells: row(4, 0, 4) });
    if (!out.ok) throw new Error(out.reason);
    expect(out.log.result.activeClearsByType).toMatchObject({ attack: 2, shield: 1 });
    expect(out.state.ap).toBe(2);
    expect(out.state.cards!.hand).toHaveLength(4);
    expect(out.state.cards!.discard.map((c) => c.defId)).toEqual(['basic-I']);
  });

  it('卡片可以旋转后放置；形状不符时拒绝', () => {
    const s = cardBattle(starterDeck('blade'));
    const vertical = [0, 1, 2, 3].map((r) => ({ r, c: 5 }));
    expect(playerAction(s, { type: 'playCard', index: handIndex(s, 'basic-I'), cells: vertical }).ok).toBe(true);
    const bent = [{ r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 1 }, { r: 1, c: 2 }];
    expect(playerAction(s, { type: 'playCard', index: handIndex(s, 'basic-I'), cells: bent })).toMatchObject({ ok: false, reason: 'badShape' });
  });

  it('覆盖到炸弹就引爆它，并照常接力', () => {
    const s = cardBattle(starterDeck('blade'), { '4,2': 'H' });
    const out = playerAction(s, { type: 'playCard', index: handIndex(s, 'basic-I'), cells: row(4, 0, 4) });
    if (!out.ok) throw new Error(out.reason);
    const waves = out.log.result.events.filter((e) => e.type === 'wave');
    expect(waves[0]!.type === 'wave' && waves[0]!.queued).toHaveLength(1);
    expect(waves[1]!.type === 'wave' && waves[1]!.explosions[0]!.shape).toBe('H');
  });

  it('属性卡：锋刃每覆盖一个攻击方块，攻击基数 +2', () => {
    const s = cardBattle(starterDeck('blade'), { '2,0': 'a', '2,1': 'a', '2,2': 'a', '3,1': 's' });
    const tShape = [{ r: 2, c: 0 }, { r: 2, c: 1 }, { r: 2, c: 2 }, { r: 3, c: 1 }];
    const out = playerAction(s, { type: 'playCard', index: handIndex(s, 'blade'), cells: tShape });
    if (!out.ok) throw new Error(out.reason);
    expect(out.log.result.socketBonuses.attack).toBe(6);
  });

  it('卡牌模式不能交换或点燃；费用不足不能打出', () => {
    const s = cardBattle(starterDeck('blade'));
    expect(playerAction(s, { type: 'swap', from: { r: 0, c: 0 }, to: { r: 0, c: 1 } })).toMatchObject({ ok: false, reason: 'cardMode' });
    const broke = { ...s, ap: 0 };
    expect(playerAction(broke, { type: 'playCard', index: handIndex(broke, 'basic-I'), cells: row(0, 0, 4) })).toMatchObject({ ok: false, reason: 'noAp' });
  });

  it('同种子、同样的出牌得到完全相同的状态', () => {
    const play = () => {
      let s = startBattle({
        seed: 9,
        player: { hp: 40, maxHp: 40, shield: 0, catalystCharges: 0 },
        enemy: { id: 'dummy', name: '木桩', maxHp: 500, script: [attack(3)], fallbackDefend: 3 },
        deck: [...starterDeck('venomSac'), makeCard('basic-S', 'x')],
      });
      for (let t = 0; t < 4; t++) {
        const i = handIndex(s, 'basic-I');
        if (i >= 0) {
          const out = playerAction(s, { type: 'playCard', index: i, cells: row(t, 0, 4) });
          if (out.ok) s = out.state;
        }
        s = endTurn(s).state;
      }
      return JSON.stringify(s);
    };
    expect(play()).toBe(play());
  });
});
