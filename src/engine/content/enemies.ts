// 九战敌人的内容数据。行为设计见 docs/ENEMY_DESIGN.md；生命与伤害为占位值，待模拟器与试玩校准。
import type { EnemyDef, Intent } from '../battle';

const atk = (amount: number): Intent => ({ parts: [{ kind: 'attack', amount }] });

/** 第 1 战：直接攻击，教玩家看意图、在攻击与护盾之间取舍 */
export const CRYSTAL_MOLE: EnemyDef = {
  id: 'crystal-mole',
  name: '晶背鼹鼠',
  maxHp: 273,
  fallbackDefend: 8,
  script: [atk(12), atk(17), atk(12), atk(21)],
};

/** 第 2 战：先蓄力再俯冲，教玩家用毒气眩晕打断大招（被打断的攻击连带作废蓄力） */
export const CAVE_BATS: EnemyDef = {
  id: 'cave-bats',
  name: '洞蝠群',
  maxHp: 326,
  fallbackDefend: 8,
  // 蓄力后的俯冲 14+14=28，超过护盾上限 20，必须眩晕、抢杀或硬吃
  script: [{ parts: [{ kind: 'charge', amount: 14 }] }, atk(14), atk(10)],
};

/** 第 3 战（精英）：倍率侵蚀，教玩家先用小消除承担侵蚀，再准备爆发 */
export const ROCK_CRAB: EnemyDef = {
  id: 'rock-crab',
  name: '吞光岩蟹',
  maxHp: 525,
  fallbackDefend: 12,
  script: [
    atk(20),
    { parts: [{ kind: 'erodeMultiplier' }, { kind: 'attack', amount: 14 }] },
    atk(29),
    { parts: [{ kind: 'defend', amount: 13 }, { kind: 'attack', amount: 11 }] },
  ],
};

export type EnemyTier = 'minion' | 'elite' | 'boss';

export interface RouteNode {
  enemy: EnemyDef;
  tier: EnemyTier;
}

/** 第一段落：小怪 → 小怪 → 精英 */
export const SEGMENT_1: RouteNode[] = [
  { enemy: CRYSTAL_MOLE, tier: 'minion' },
  { enemy: CAVE_BATS, tier: 'minion' },
  { enemy: ROCK_CRAB, tier: 'elite' },
];
