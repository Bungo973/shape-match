// 嵌片卡（原型）：数据定义与牌堆操作。设计见 docs/CARD_DESIGN.md（讨论稿）。
// 原型只包含消除卡：基础卡与四种属性卡；费用与数值为临时值。
import { normalize, SHAPES, type ShapeName } from './inserts';
import type { Rng } from './rng';
import type { Color, Pos } from './types';

export type CardCategory = 'clear' | 'status' | 'utility';

export interface CardDef {
  id: string;
  name: string;
  category: CardCategory;
  cost: number;
  /** 初始形状 */
  shape: ShapeName;
  /** 属性卡的颜色词条 */
  attribute?: Color;
  text: string;
}

/** 属性卡每覆盖一个对应颜色的方块提供的基数（催化剂为额外计数） */
export const ATTRIBUTE_PER_TILE: Record<Color, number> = { attack: 2, shield: 2, poison: 2, catalyst: 1 };

export const CARD_DEFS: Record<string, CardDef> = {
  'basic-I': { id: 'basic-I', name: '直条', category: 'clear', cost: 1, shape: 'I', text: '清除覆盖的格子。' },
  'basic-O': { id: 'basic-O', name: '方块', category: 'clear', cost: 1, shape: 'O', text: '清除覆盖的格子。' },
  'basic-T': { id: 'basic-T', name: 'T 字', category: 'clear', cost: 1, shape: 'T', text: '清除覆盖的格子。' },
  'basic-L': { id: 'basic-L', name: 'L 字', category: 'clear', cost: 1, shape: 'L', text: '清除覆盖的格子。' },
  'basic-S': { id: 'basic-S', name: 'S 字', category: 'clear', cost: 1, shape: 'S', text: '清除覆盖的格子。' },
  blade: { id: 'blade', name: '锋刃', category: 'clear', cost: 1, shape: 'T', attribute: 'attack', text: '清除覆盖的格子；每覆盖一个攻击方块，攻击基数 +2。' },
  bulwark: { id: 'bulwark', name: '壁垒', category: 'clear', cost: 1, shape: 'O', attribute: 'shield', text: '清除覆盖的格子；每覆盖一个护盾方块，护盾基数 +2。' },
  venomSac: { id: 'venomSac', name: '毒囊', category: 'clear', cost: 1, shape: 'S', attribute: 'poison', text: '清除覆盖的格子；每覆盖一个毒气方块，毒气基数 +2。' },
  catalystSalt: { id: 'catalystSalt', name: '催化盐', category: 'clear', cost: 1, shape: 'L', attribute: 'catalyst', text: '清除覆盖的格子；每覆盖一个催化剂，多算一个。' },
};

export const ATTRIBUTE_CARDS = ['blade', 'bulwark', 'venomSac', 'catalystSalt'] as const;
export const STARTER_BASICS = ['basic-I', 'basic-O', 'basic-T', 'basic-L'] as const;

/** 牌组中的一张卡：形状可随升级改变，所以每张卡保存自己的格子 */
export interface CardInstance {
  uid: string;
  defId: string;
  /** 相对坐标，已归一化 */
  cells: Pos[];
}

export function makeCard(defId: string, uid: string): CardInstance {
  const def = CARD_DEFS[defId];
  if (!def) throw new Error(`未知卡牌 ${defId}`);
  return { uid, defId, cells: normalize(SHAPES[def.shape]) };
}

/** 起始牌组（方案 C）：四张基础卡 + 开局选定的一张属性卡 */
export function starterDeck(attribute: (typeof ATTRIBUTE_CARDS)[number]): CardInstance[] {
  return [...STARTER_BASICS, attribute].map((id, i) => makeCard(id, `c${i + 1}`));
}

/** 打出这张卡时交给结算的颜色词条 */
export function cardBonus(card: CardInstance): { color: Color; perTile: number } | undefined {
  const color = CARD_DEFS[card.defId]!.attribute;
  return color ? { color, perTile: ATTRIBUTE_PER_TILE[color] } : undefined;
}

/** 就地洗牌（Fisher–Yates），顺序由种子随机数决定 */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

export interface CardPiles {
  draw: CardInstance[];
  hand: CardInstance[];
  discard: CardInstance[];
}

/** 抽 n 张：抽牌堆不足时把弃牌堆洗回；手牌达到上限后多余的抽牌跳过 */
export function drawCards(piles: CardPiles, n: number, handLimit: number, rng: Rng): void {
  for (let i = 0; i < n; i++) {
    if (piles.hand.length >= handLimit) return;
    if (piles.draw.length === 0) {
      if (piles.discard.length === 0) return;
      piles.draw = shuffle(piles.discard, rng);
      piles.discard = [];
    }
    piles.hand.push(piles.draw.pop()!);
  }
}
