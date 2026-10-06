// 道具：商店用金币买、关内随时使用的一次性消耗品（2026-09-30）。只做玩家熟悉的传统道具，不做修饰数值的药剂。
// 结算复用已有动作：锤子是对一格的一次爆炸，雷管是对所有炸弹格的一次爆炸，手套是不要求能消除的交换，炸药包与洗牌直接改棋盘。
// 2026-09-30 改版：道具要给棋盘上稀缺的东西（大爆发），关末平均还剩 5.5 枚炸弹没用，所以炸药包改放五连、新增雷管。
// 2026-10-06 定为不消耗步数（config.itemCostsStep 默认 false，仅供模拟对比）。设计见 docs/DESIGN_JOURNAL.md 第 16 节。

export type ItemKey = 'hammer' | 'glove' | 'charge' | 'detonator' | 'shuffle';

/** 使用时要选什么：一格、两格相邻，或不用选 */
export type ItemTarget = 'cell' | 'pair' | 'none';

export interface ItemDef {
  key: ItemKey;
  name: string;
  text: string;
  price: number;
  target: ItemTarget;
}

export const ITEMS: Record<ItemKey, ItemDef> = {
  hammer: { key: 'hammer', name: '锤子', text: '砸掉任意一格：砸到炸弹就引爆，砸到石块就清掉，之后照常下落、连锁、计分。', price: 4, target: 'cell' },
  glove: { key: 'glove', name: '手套', text: '任意两格相邻互换，不要求能消除。', price: 6, target: 'pair' },
  charge: { key: 'charge', name: '炸药包', text: '把任意一个普通方块变成五连炸弹。', price: 10, target: 'cell' },
  detonator: { key: 'detonator', name: '雷管', text: '引爆棋盘上所有炸弹，照常连锁、计分。', price: 8, target: 'none' },
  shuffle: { key: 'shuffle', name: '洗牌', text: '整盘重新排列（炸弹与石块不动）。', price: 5, target: 'none' },
};

export const ITEM_KEYS = Object.keys(ITEMS) as ItemKey[];
