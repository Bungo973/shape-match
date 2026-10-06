// 道具：关内掉落的一次性战术道具（2026-10-06 重做）。做出五连炸弹或一步连锁 8 层以上时掉一件，带到下一关也能用，使用不扣步。
// 只做两类效果（用户定）：改棋盘布局（手套、吸管、洗牌）和改倍率或得分（放大镜、回声）。商店不再卖道具。
// 结算复用已有入口：手套是不要求相邻、不要求能消除的交换（炸弹只挪不炸），吸管是“染色后照常结算”的动作，洗牌直接重排；放大镜挂到下一次结算，回声直接加分。
// 设计见 docs/DESIGN_JOURNAL.md 第 25 节。

export type ItemKey = 'glove' | 'dropper' | 'shuffle' | 'magnifier' | 'echo';

/** 使用时要选什么：任意两格（手套）、相邻两格（吸管），或不用选 */
export type ItemTarget = 'any' | 'pair' | 'none';

export interface ItemDef {
  key: ItemKey;
  name: string;
  text: string;
  target: ItemTarget;
}

export const ITEMS: Record<ItemKey, ItemDef> = {
  glove: { key: 'glove', name: '手套', text: '棋盘上任意两格互换，不必相邻，也不要求能消除；炸弹也能换，只挪位置不引爆。', target: 'any' },
  dropper: { key: 'dropper', name: '吸管', text: '先点一格取色，再点相邻一格染成这个颜色；染完成线就照常消除、连锁、计分。', target: 'pair' },
  shuffle: { key: 'shuffle', name: '洗牌', text: '整盘重新排列（炸弹与石块不动）。', target: 'none' },
  magnifier: { key: 'magnifier', name: '放大镜', text: '下一次结算倍率 ×2。', target: 'none' },
  echo: { key: 'echo', name: '回声', text: '再得一次上一步的分数。', target: 'none' },
};

export const ITEM_KEYS = Object.keys(ITEMS) as ItemKey[];

export const ITEM_PARAMS = {
  magnifierFactor: 2,
  /** 掉落条件：一步连锁达到这么多层 */
  dropChain: 8,
  /** 每关最多掉落几件 */
  dropsPerLevel: 2,
};
